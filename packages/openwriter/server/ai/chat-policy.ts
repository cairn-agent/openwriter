/**
 * What the chat agent may do. Pure rules, no SDK, so they are tested on their own.
 *
 * - The agent gets OpenWriter's tools (TOOL_REGISTRY) and nothing else: every
 *   Claude Code built-in is switched off (`tools: []`), and any tool that is not
 *   one of ours is denied at the permission check as well.
 * - Some of our tools are left out of the chat: background minion work, tools
 *   that reach the local machine, and account and billing steps the writer does
 *   in the UI.
 * - Tools that publish, send email, delete or restore pause for the writer to
 *   confirm or cancel in the chat. The rule is by name, so a new plugin tool
 *   named delete_x or send_x is covered without a list edit.
 *
 * adr: adr/writer-key-ai.md
 */

/** The in-process MCP server's name; tools reach the model as mcp__openwriter__<tool>. */
export const CHAT_MCP_SERVER = 'openwriter';
const PREFIX = `mcp__${CHAT_MCP_SERVER}__`;

export const CHAT_EXCLUDED_TOOLS = new Set([
  // Background minion work, not conversation.
  'claim_enrichment', 'mark_enriched', 'list_dirty_docs', 'list_pending_sorts', 'propose_sort', 'mark_sorted',
  // The local machine: absolute paths, files outside the data folder.
  'open_file', 'reload_from_disk', 'export_manuscript', 'crawl',
  // Blog repo setup runs git against local clones; it is a settings task.
  'add_blog_site', 'edit_blog_site', 'inspect_blog_repo', 'remove_blog_site',
  // Account, billing and team steps the writer does in the UI.
  'request_login_code', 'verify_login', 'connect_stripe', 'disconnect_stripe', 'manage_billing', 'upgrade_plan',
  'invite_to_team', 'remove_team_member', 'accept_team_invite', 'update_team_member',
]);

const CONFIRM_PREFIXES = ['delete_', 'remove_', 'restore_', 'publish_', 'unpublish_', 'send_', 'resend_', 'post_to_', 'schedule_'];
const CONFIRM_NAMES = new Set(['manage_schedule']);

/** True when the writer must confirm this tool call in the chat first. */
export function needsConfirmation(tool: string): boolean {
  return CONFIRM_NAMES.has(tool) || CONFIRM_PREFIXES.some((p) => tool.startsWith(p));
}

export function chatToolAllowed(tool: string): boolean {
  return !CHAT_EXCLUDED_TOOLS.has(tool);
}

/** Our tool's bare name from the SDK's name, or null for anything that is not ours. */
export function ownToolName(sdkName: string): string | null {
  return sdkName.startsWith(PREFIX) ? sdkName.slice(PREFIX.length) : null;
}

export type ToolDecision = 'allow' | 'confirm' | 'deny';

/**
 * The permission decision for one call. `fromOurServer` is the SDK's report
 * that the tool came from the in-process server we registered, not from config.
 */
export function decideTool(sdkName: string, fromOurServer: boolean): ToolDecision {
  const own = ownToolName(sdkName);
  if (!own || !fromOurServer || !chatToolAllowed(own)) return 'deny';
  return needsConfirmation(own) ? 'confirm' : 'allow';
}

/** One plain line for the confirm card: what the tool will do, with its main argument. */
export function describeToolCall(tool: string, input: Record<string, unknown>): string {
  const target = ['title', 'docId', 'filename', 'subject', 'name', 'versionId', 'slug']
    .map((k) => input?.[k])
    .find((v) => typeof v === 'string' && v) as string | undefined;
  const verb = tool.replace(/_/g, ' ');
  return target ? `${verb}: ${target}` : verb;
}
