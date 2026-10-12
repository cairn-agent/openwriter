import { readFileSync, writeFileSync } from 'fs';
import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, resolveSection, SITE_PARAM } from './site-tools.js';

/**
 * The writer's subscriber list: the site's members, the one list site posts are emailed to
 * (openwriter-publish adr/one-subscriber-list.md). Tool names are the old newsletter ones,
 * so writers' habits still work.
 */

const TIERS = ['free', 'paid', 'founding', 'comp'];
const STATUSES = ['active', 'pending', 'unsubscribed', 'bounced', 'all'];

const FILTER_PARAMS = {
  status: { type: 'string', enum: STATUSES, description: 'Only members in this status (default active; "all" for every status).' },
  tier: { type: 'string', enum: TIERS, description: 'Only members on this tier.' },
  source: { type: 'string', description: 'Only members who came from this source (e.g. import, manual, site, embed).' },
  search: { type: 'string', description: 'Only members whose email or name contains this, any case (e.g. "ann@" or "smith").' },
  tag: { type: 'string', description: 'Only members with this tag (tag_subscribers, list_subscriber_tags).' },
  joined_after: { type: 'string', description: 'Only members who subscribed on or after this date (ISO, e.g. 2026-01-01).' },
  joined_before: { type: 'string', description: 'Only members who subscribed before this date (ISO).' },
  opened_within_days: { type: 'number', description: 'Only members who opened or clicked an email from the site in the last this many days.' },
  not_opened_days: { type: 'number', description: 'Only members who opened and clicked nothing from the site in the last this many days.' },
  segment: { type: 'string', description: 'A saved segment by name (list_segments), instead of the other filters.' },
};

/** Query string for the member filters; status defaults to active. A segment carries its own filters. */
function filterQuery(params: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const q = new URLSearchParams();
  const segment = typeof params.segment === 'string' && params.segment.trim() ? params.segment.trim() : null;
  const filters = segment
    ? { segment }
    : {
        status: typeof params.status === 'string' ? params.status : 'active',
        tier: params.tier, source: params.source, search: params.search, tag: params.tag,
        from: params.joined_after, to: params.joined_before,
        opened_within_days: params.opened_within_days, not_opened_days: params.not_opened_days,
      };
  for (const [k, v] of Object.entries({ ...filters, ...extra })) {
    if (v !== undefined && v !== null && v !== '' && !(k === 'status' && v === 'all')) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** One CSV field, quoted when it holds a comma, quote or newline. */
function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Reads exports from ConvertKit, Mailchimp, Substack, Beehiiv and the like: finds the email and name
 * columns (or first + last name) by their usual headers, and drops rows whose status says unsubscribed.
 */
export function readSubscriberCsv(raw: string): { rows: { email: string; name?: string; tags?: string }[]; skippedStatus: number } | { error: string } {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { error: 'CSV must have a header row and at least one data row' };

  const parseCsvLine = (line: string): string[] => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current.trim());
    return fields;
  };

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/['"]/g, '').trim().replace(/^\u{feff}/u, ''));
  const findCol = (aliases: string[]) => headers.findIndex((h) => aliases.includes(h));
  const emailIdx = findCol(['email', 'email_address', 'email address', 'subscriber_email', 'e-mail', 'contact email']);
  const nameIdx = findCol(['name', 'full_name', 'full name', 'subscriber_name']);
  const firstIdx = findCol(['first_name', 'first name', 'firstname', 'first']);
  const lastIdx = findCol(['last_name', 'last name', 'lastname', 'last']);
  const statusIdx = findCol(['status', 'state', 'subscription_status']);
  const tagsIdx = findCol(['tags', 'tag', 'labels']);
  if (emailIdx === -1) return { error: `Could not find email column. Found headers: ${headers.join(', ')}` };

  const skipStatuses = new Set(['unsubscribed', 'cancelled', 'canceled', 'inactive', 'bounced', 'complained']);
  const rows: { email: string; name?: string; tags?: string }[] = [];
  let skippedStatus = 0;
  const clean = (s: string | undefined) => (s || '').replace(/['"]/g, '').trim();

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    const email = clean(fields[emailIdx]);
    if (!email) continue;
    if (statusIdx !== -1 && skipStatuses.has(clean(fields[statusIdx]).toLowerCase())) {
      skippedStatus++;
      continue;
    }
    let name: string | undefined;
    if (nameIdx !== -1) name = clean(fields[nameIdx]) || undefined;
    else if (firstIdx !== -1) {
      name = [clean(fields[firstIdx]), lastIdx !== -1 ? clean(fields[lastIdx]) : ''].filter(Boolean).join(' ') || undefined;
    }
    const tags = tagsIdx !== -1 ? clean(fields[tagsIdx]) : '';
    rows.push({ email, ...(name ? { name } : {}), ...(tags ? { tags } : {}) });
  }
  return { rows, skippedStatus };
}

export function siteMemberTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'list_subscribers',
      description:
        'List the site\'s subscribers (its members: the list site posts are emailed to), newest first, with their tags. ' +
        'Active members by default; filter by status, tier, source, search, section (who gets that section\'s emails), tag, ' +
        'when they joined, and whether they opened an email lately; or give a saved segment instead. ' +
        'Works before a site name is claimed too.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max subscribers to return (default 100, at most 500)' },
          offset: { type: 'number', description: 'Pagination offset (default 0)' },
          ...FILTER_PARAMS,
          section: { type: 'string', description: 'Only members subscribed to this section (its id, slug or name, from list_site_sections).' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        let section: string | null = null;
        if (typeof params.section === 'string' && params.section.trim()) {
          const found = await resolveSection(config, params.site, params.section);
          if (found && typeof found === 'object') return found;
          section = found;
        }
        const query = filterQuery(params, { limit: params.limit ?? 100, offset: params.offset ?? 0, section });
        const res = await publishFetch(config, `/sites/members${query}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Failed to list subscribers');
        const data = (await res.json()) as { members: any[]; total: number };
        return {
          count: data.total,
          subscribers: data.members.map((m) => ({
            id: m.id, email: m.email, name: m.name, tier: m.tier, status: m.status, source: m.source,
            subscribedAt: m.subscribed_at, tags: m.tags ?? [],
          })),
        };
      },
    },

    {
      name: 'get_subscriber_counts',
      description:
        'How many subscribers the site has: active members by tier (free, paid, founding, comp) and every member by status. ' +
        'With segment, the same counts for that saved segment.',
      inputSchema: { type: 'object', properties: { segment: FILTER_PARAMS.segment, ...SITE_PARAM } },
      handler: async (params) => {
        const segment = typeof params.segment === 'string' && params.segment.trim() ? params.segment.trim() : null;
        const res = await publishFetch(config, `/sites/members/counts${segment ? `?segment=${encodeURIComponent(segment)}` : ''}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Failed to count subscribers');
        const data = (await res.json()) as { counts: object; segment?: string };
        return data.segment ? { segment: data.segment, ...data.counts } : data.counts;
      },
    },

    {
      name: 'add_subscriber',
      description:
        'Add one person to the site\'s subscriber list as an active free member. Someone who unsubscribed or bounced ' +
        'is not re-added: only they can subscribe again. With send_welcome they get the site\'s welcome email, once.',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Subscriber email address' },
          name: { type: 'string', description: 'Subscriber name (optional)' },
          send_welcome: {
            type: 'boolean',
            description: 'Also send them the welcome email (default false). Nobody is welcomed twice; while the site is in review it counts toward the daily sending limit.',
          },
          ...SITE_PARAM,
        },
        required: ['email'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/members', onSite(params.site, {
          method: 'POST',
          body: JSON.stringify({
            email: params.email,
            ...(params.name ? { name: params.name } : {}),
            ...(params.send_welcome === true ? { send_welcome: true } : {}),
          }),
        }));
        if (!res.ok) return apiError(res, 'Failed to add subscriber');
        const data = (await res.json()) as { member: any; created: boolean; welcome_sent?: boolean; welcome_note?: string };
        const added = data.created ? `Added ${data.member.email}.` : `${data.member.email} was already on the list.`;
        if (data.welcome_sent === undefined) return { success: true, subscriber: data.member, message: added };
        const welcome = data.welcome_sent ? 'Sent the welcome email.' : (data.welcome_note ?? 'No welcome email was sent.');
        return { success: true, subscriber: data.member, welcome_sent: data.welcome_sent, message: `${added} ${welcome}` };
      },
    },

    {
      name: 'remove_subscriber',
      description:
        'Unsubscribe a subscriber from the site by their id (from list_subscribers). They get no more email; ' +
        'they stay in the list as unsubscribed, and only they can subscribe again.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The subscriber id from list_subscribers' }, ...SITE_PARAM },
        required: ['id'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/members/${encodeURIComponent(String(params.id))}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Failed to remove subscriber');
        return { success: true, message: 'Unsubscribed.' };
      },
    },

    {
      name: 'import_subscribers',
      description:
        'Bulk import subscribers into the site\'s list from a CSV file or pasted CSV text (up to 10,000 rows). Reads exports ' +
        'from ConvertKit, Mailchimp, Substack, Beehiiv, etc. (email/Email Address, name or first+last name). Skips invalid ' +
        'emails, rows marked unsubscribed, repeats, and anyone already on the list (an unsubscribed person is never re-added). ' +
        'A "tags" column (tags separated by commas or semicolons) tags each row\'s subscriber, new or already on the list. ' +
        'Imported people get no confirmation email.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Absolute path to a CSV file (e.g. "C:/Users/me/Downloads/subscribers.csv")' },
          csv_text: { type: 'string', description: 'Raw CSV text pasted directly (header row + data rows)' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const filePath = params.file as string | undefined;
        const csvText = params.csv_text as string | undefined;
        if (!filePath && !csvText) return { error: 'Provide either file (path to CSV) or csv_text (raw CSV content)' };

        let raw: string;
        try {
          raw = filePath ? readFileSync(filePath, 'utf-8') : csvText!;
        } catch (e: any) {
          return { error: `Failed to read file: ${e.message}` };
        }
        const parsed = readSubscriberCsv(raw);
        if ('error' in parsed) return parsed;
        const { rows, skippedStatus } = parsed;
        if (rows.length === 0) return { error: `No valid subscribers found. ${skippedStatus} skipped (unsubscribed/inactive).` };

        const csv = ['email,name,tags', ...rows.map((r) => `${csvField(r.email)},${csvField(r.name ?? '')},${csvField(r.tags ?? '')}`)].join('\n');
        const res = await publishFetch(config, '/sites/members/import', onSite(params.site, {
          method: 'POST',
          body: JSON.stringify({ csv }),
        }));
        if (!res.ok) return apiError(res, 'Import failed');
        const data = (await res.json()) as {
          imported: number;
          tagged?: number;
          skipped: { already_members: number; duplicate_in_file: number; invalid: number; banned?: number };
          invalid_examples: string[];
        };
        const s = data.skipped;
        const notes = [
          data.tagged && `${data.tagged} tagged from the tags column`,
          skippedStatus && `${skippedStatus} skipped (unsubscribed/inactive in the file)`,
          s.already_members && `${s.already_members} already on the list (left as they were)`,
          s.duplicate_in_file && `${s.duplicate_in_file} repeated in the file`,
          s.invalid && `${s.invalid} skipped (invalid email)`,
          s.banned && `${s.banned} skipped (banned from the site)`,
        ].filter(Boolean);
        return {
          success: true,
          imported: data.imported,
          skippedStatus,
          alreadyMembers: s.already_members,
          duplicates: s.duplicate_in_file,
          skippedInvalid: s.invalid,
          skippedBanned: s.banned ?? 0,
          tagged: data.tagged ?? 0,
          invalidExamples: data.invalid_examples,
          message: `Imported ${data.imported} subscribers.${notes.length ? ` ${notes.join('. ')}.` : ''}`,
        };
      },
    },

    {
      name: 'export_subscribers',
      description:
        'Export the site\'s subscribers as CSV (email, name, tier, status, source, subscribed_at, tags, billing_country). ' +
        'Active members by default; takes the same filters as list_subscribers, or a saved segment. ' +
        'Saves to file when given, otherwise returns the CSV text.',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Absolute path to save the CSV to (e.g. "C:/Users/me/Downloads/subscribers.csv")' },
          ...FILTER_PARAMS,
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/members/export${filterQuery(params)}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Export failed');
        const csv = await res.text();
        const rows = Math.max(csv.split(/\r?\n/).filter((l) => l.trim()).length - 1, 0);
        if (!params.file) return { rows, csv };
        try {
          writeFileSync(String(params.file), csv, 'utf-8');
        } catch (e: any) {
          return { error: `Failed to save file: ${e.message}` };
        }
        return { success: true, rows, file: params.file, message: `Saved ${rows} subscribers to ${params.file}.` };
      },
    },

    {
      name: 'get_subscribe_embed',
      description:
        'Get the public subscribe URL and embed code for a signup form on another website. Signups join the site\'s ' +
        'subscriber list. Returns an HTML form snippet (works without JS) and a JS fetch snippet.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/members/embed', onSite(params.site));
        if (!res.ok) return apiError(res, 'Failed');
        const data = (await res.json()) as { site_url: string | null; double_opt_in: boolean };
        const lands = !data.site_url
          ? 'Signups join your list at once. No site name is claimed yet: claim one (claim_site_name) to send them posts; from then on the site\'s own rules apply.'
          : data.double_opt_in
            ? 'Signups get a confirmation email first and join your list once they click it (double opt-in is on).'
            : 'Signups join your list at once (double opt-in is off).';
        return {
          ...data,
          instructions: [
            'HTML Form: Paste embed_html into any page. Replace YOUR_THANK_YOU_PAGE_URL. Works without JavaScript.',
            'JS Fetch: Use embed_js for AJAX submissions (no page reload). Returns { success: true } on success.',
            'hp_field is a honeypot — keep it hidden and empty.',
            'Set source to identify each form placement (e.g. "homepage", "footer", "blog-sidebar").',
            lands,
          ].join('\n'),
        };
      },
    },
  ];
}
