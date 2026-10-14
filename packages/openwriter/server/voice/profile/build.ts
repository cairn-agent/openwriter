/**
 * The writer's voice profile, built from the documents in their voice: Author's Voice's setup
 * (VoiceOnboardingService.setupVoice: Human text only, at least 200 words, processContent, then
 * analyze on the premium model) and its anchor derivation (AnchorBlendService.match: the blend
 * matcher). Saved to `<profile>/voice/profile.json`; the editor reads it (editor/prompt.ts).
 * adr: adr/authors-voice.md
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';
import { dataDir } from '../host.js';
import logger from '../logger.js';
import { voiceIndex } from '../voice/voice-index.js';
import { readParagraphs } from '../voice/voice-enrich.js';
import { analyze, type AuthorVoiceGuidelines } from './AuthorVoiceAnalysis.js';
import { processContent } from './process-content.js';
import { AVModelService } from './AVModelService.js';
import { matchVoice, type AnchorBlendRow } from './voiceMatcher/matcher.js';

/** VoiceOnboardingService.MIN_WORDS_FOR_ANALYSIS */
const MIN_WORDS_FOR_ANALYSIS = 200;
/**
 * Author's Voice's matcher took whatever samples its caller sent. Here the caller is every
 * document in the voice, so the samples are capped to keep one call a sensible size.
 */
const MATCHER_SAMPLE_WORDS = 6000;

export interface StoredProfile {
  guidelines: AuthorVoiceGuidelines | null;
  anchorBlend: AnchorBlendRow[] | null;
  /** Human words the profile was built from, to rebuild only when the voice grew or changed. */
  analyzedWords: number;
  analyzedHash: string;
  analyzedAt: string | null;
}

const profileFile = () => join(dataDir(), 'voice', 'profile.json');

export function readProfile(): StoredProfile | null {
  try {
    return existsSync(profileFile()) ? JSON.parse(readFileSync(profileFile(), 'utf-8')) : null;
  } catch {
    return null;
  }
}

function writeProfile(p: StoredProfile): void {
  mkdirSync(join(dataDir(), 'voice'), { recursive: true });
  const tmp = profileFile() + '.tmp';
  writeFileSync(tmp, JSON.stringify(p, null, 2));
  renameSync(tmp, profileFile());
}

/** The writer's own paragraphs in the voice, one sample per document. */
async function humanSamples(): Promise<string[]> {
  const idx = voiceIndex(dataDir());
  const samples: string[] = [];
  for (const docId of idx.docIds()) {
    try {
      const { chunks } = await readParagraphs(docId);
      const human = chunks.filter((c) => (idx.chunk(docId, c.nodeId)?.authenticity ?? 'Human') === 'Human');
      if (human.length) samples.push(human.map((c) => c.text).join('\n\n'));
    } catch { /* a document that cannot be read is left out */ }
  }
  return samples;
}

const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
const hashOf = (samples: string[]) => createHash('sha256').update(JSON.stringify(samples)).digest('hex').slice(0, 16);

export type BuildStatus = 'needs_more_samples' | 'unchanged' | 'analyzed';

let running: Promise<BuildStatus> | null = null;

/** Rebuild the profile when the writer's own text in the voice changed. One run at a time. */
export function buildProfile(): Promise<BuildStatus> {
  if (running) return running;
  running = doBuild().finally(() => { running = null; });
  return running;
}

async function doBuild(): Promise<BuildStatus> {
  const samples = await humanSamples();
  const totalWords = countWords(samples.join(' '));
  if (totalWords < MIN_WORDS_FOR_ANALYSIS) return 'needs_more_samples';
  const prev = readProfile();
  const hash = hashOf(samples);
  if (prev && prev.analyzedHash === hash) return 'unchanged';

  const guidelines = await analyze(processContent(samples.join('\n\n')), async (prompt) => {
    const { content } = await AVModelService.call(prompt, undefined, 'premium');
    return content;
  });
  if (!guidelines.author_voice_guidelines.user_friendly_summary) {
    throw new Error('AI failed to generate user-friendly summary - this is required');
  }

  let anchorBlend = prev?.anchorBlend ?? null;
  try {
    const capped: string[] = [];
    let used = 0;
    for (const s of samples) {
      if (used >= MATCHER_SAMPLE_WORDS) break;
      const words = s.split(/\s+/).filter(Boolean);
      const take = words.slice(0, MATCHER_SAMPLE_WORDS - used);
      capped.push(take.join(' '));
      used += take.length;
    }
    anchorBlend = (await matchVoice(capped, 'general')).blend;
  } catch (err: any) {
    logger.warn('blend match failed; keeping the previous blend', err?.message || err);
  }

  writeProfile({ guidelines, anchorBlend, analyzedWords: totalWords, analyzedHash: hash, analyzedAt: new Date().toISOString() });
  return 'analyzed';
}
