/**
 * Which Claude model each job uses, chosen from Anthropic's own model list rather than written
 * here: every call names a line (Opus, Sonnet or Haiku) and gets that line's newest active model.
 * A new Claude model is picked up within a day with no release of OpenWriter.
 *
 *  - The list (GET /v1/models, newest first) is read at most once a day with the writer's key and
 *    kept in `<data root>/ai/models.json`, so a restart or an unreachable list keeps the last good
 *    choice. Before any list was read, the built-in choices below apply.
 *  - What a model accepts comes from its own entry (`capabilities`), not from rules per model:
 *    whether it takes an effort level, and whether its thinking can be turned off.
 *  - Models that refuse `temperature` are learned from the API's answer and remembered
 *    (`createMessage`), since the list does not say.
 * adr: adr/authors-voice.md
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { aiDir, claude, type MessagesClient } from './host.js';

export type ModelChoice = 'opus' | 'sonnet' | 'haiku';

export interface LiveModel {
  id: string;
  /** Anthropic's own name for it, e.g. "Claude Opus 5.5". */
  name: string;
  /** Takes `output_config.effort` (and thinks by default when it does). */
  effort: boolean;
  /** Accepts `thinking: { type: 'disabled' }`. */
  thinkingOff: boolean;
}

/** The choices a writer sees. The model behind each is looked up. */
export const MODELS: Record<ModelChoice, { label: string }> = {
  opus: { label: 'Opus' },
  sonnet: { label: 'Sonnet' },
  haiku: { label: 'Haiku' },
};

export const DEFAULT_REWRITE_MODEL: ModelChoice = 'opus';
export const DEFAULT_CHAT_MODEL: ModelChoice = 'sonnet';

/** Used until the list has been read once. */
const BUILT_IN: Record<ModelChoice, LiveModel> = {
  opus: { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', effort: true, thinkingOff: false },
  sonnet: { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', effort: true, thinkingOff: false },
  haiku: { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', effort: false, thinkingOff: true },
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** After a failed read, wait this long before trying again. */
const RETRY_MS = 60 * 60 * 1000;
/** With nothing read yet, how long a call waits for the first read before using the built-ins. */
const FIRST_READ_WAIT_MS = 3000;

interface ModelsFile {
  checkedAt: number;
  models: Record<ModelChoice, LiveModel>;
  /** Model ids that answered 400 to `temperature`. */
  noTemperature: string[];
}

const modelsFile = () => join(aiDir(), 'models.json');
let state: ModelsFile | null = null;
let triedAt = 0;
let reading: Promise<void> | null = null;

function load(): ModelsFile {
  if (state) return state;
  try {
    if (existsSync(modelsFile())) state = JSON.parse(readFileSync(modelsFile(), 'utf8'));
  } catch { /* unreadable: start over */ }
  state ??= { checkedAt: 0, models: { ...BUILT_IN }, noTemperature: [] };
  state.models = { ...BUILT_IN, ...state.models };
  state.noTemperature ??= [];
  return state;
}

function persist(): void {
  try {
    mkdirSync(aiDir(), { recursive: true });
    const tmp = `${modelsFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, modelsFile());
  } catch { /* kept in memory for this run */ }
}

interface ListedModel {
  id: string;
  display_name?: string;
  line?: string | null;
  lifecycle?: string;
  capabilities?: {
    effort?: { low?: { supported?: boolean } };
    thinking?: { types?: { disabled?: { supported?: boolean } } };
  } | null;
}

/** Each line's newest active model, from Anthropic's list (newest first). */
export function pickLatest(listed: ListedModel[]): Partial<Record<ModelChoice, LiveModel>> {
  const out: Partial<Record<ModelChoice, LiveModel>> = {};
  for (const m of listed) {
    const line = m.line as ModelChoice;
    if (!(line in MODELS) || out[line] || (m.lifecycle && m.lifecycle !== 'active')) continue;
    out[line] = {
      id: m.id,
      name: m.display_name || m.id,
      effort: m.capabilities?.effort?.low?.supported === true,
      thinkingOff: m.capabilities?.thinking?.types?.disabled?.supported !== false,
    };
  }
  return out;
}

async function readList(): Promise<void> {
  triedAt = Date.now();
  let client: MessagesClient;
  try { client = claude(); } catch { return; } // no key: keep what we have
  const models = (client as Partial<Pick<Anthropic, 'models'>>).models;
  if (typeof models?.list !== 'function') return;
  try {
    const page = await models.list({ limit: 100 });
    const latest = pickLatest((page.data ?? []) as unknown as ListedModel[]);
    const s = load();
    s.models = { ...s.models, ...latest };
    s.checkedAt = Date.now();
    persist();
  } catch (err: any) {
    console.warn('[voice] could not read the model list; keeping the last choice:', err?.status ?? err?.message ?? err);
  }
}

/** Start a read of the list when the last one is a day old (or failed an hour ago). */
function refresh(): Promise<void> {
  const s = load();
  const due = Date.now() - s.checkedAt > DAY_MS && Date.now() - triedAt > RETRY_MS;
  if (due && !reading) reading = readList().finally(() => { reading = null; });
  return reading ?? Promise.resolve();
}

/** The model a job uses now: the newest of that line. */
export async function modelFor(line: ModelChoice): Promise<LiveModel> {
  const s = load();
  const pending = refresh();
  // Never read yet on this machine: give the first read a moment, then go on with the built-ins.
  if (s.checkedAt === 0) await Promise.race([pending, new Promise((ok) => setTimeout(ok, FIRST_READ_WAIT_MS))]);
  return load().models[line];
}

/** The writer's choice, or the fallback when it is not one of ours. */
export function resolveChoice(choice: unknown, fallback: ModelChoice): ModelChoice {
  return (typeof choice === 'string' && choice in MODELS ? choice : fallback) as ModelChoice;
}

/** Room added to `max_tokens` for a model that thinks, since thinking spends from the same ceiling. */
export const THINKING_ROOM = 8000;

/**
 * A plain call for the copied prompts, which were written for models that do not think: thinking
 * off where the model allows it; where it cannot be turned off (Sonnet 5.5, Opus 5.5), the
 * lowest effort and room for the thinking on top of the prompt's own length. The temperature is
 * dropped for a model that refuses it; a refusal is learned once and remembered.
 */
export async function createMessage(
  client: MessagesClient,
  model: LiveModel,
  params: Omit<Anthropic.MessageCreateParamsNonStreaming, 'model'>,
): Promise<Anthropic.Message> {
  const s = load();
  const { temperature, ...rest } = params;
  const thinks = !model.thinkingOff && model.effort;
  const body = {
    ...rest,
    model: model.id,
    ...(model.thinkingOff ? { thinking: { type: 'disabled' } } : {}),
    ...(thinks ? { max_tokens: rest.max_tokens + THINKING_ROOM, output_config: { effort: 'low' } } : {}),
  } as Anthropic.MessageCreateParamsNonStreaming;
  if (temperature === undefined || s.noTemperature.includes(model.id)) return client.messages.create(body);
  try {
    return await client.messages.create({ ...body, temperature });
  } catch (err: any) {
    // By status, not class: an embedder's client may come from another copy of the SDK.
    if (err?.status !== 400 || !/temperature/i.test(String(err?.message))) throw err;
    s.noTemperature.push(model.id);
    persist();
    return client.messages.create(body);
  }
}

/** Forget what was read (tests). */
export function resetModels(): void {
  state = null;
  triedAt = 0;
  reading = null;
}
