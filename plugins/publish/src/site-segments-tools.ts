import type { PluginMcpTool } from './helpers.js';
import { md, publishFetch } from './helpers.js';
import { sendAnswer } from './site-sending-tools.js';
import { apiError, onSite, resolveSection, SITE_PARAM } from './site-tools.js';

/**
 * Subscriber tags, saved segments, paid subscribers by billing country, and pruning
 * readers who stopped opening. Owners and admins only; a contributor gets a refusal
 * from the API. A segment is a saved filter: list_subscribers, export_subscribers,
 * get_subscriber_counts and email_subscribers take it by name.
 */

const TIERS = ['free', 'paid', 'founding', 'comp'];
const STATUSES = ['active', 'pending', 'unsubscribed', 'bounced', 'all'];

const RULE = {
  days: { type: 'number', description: 'No open or click in this many days (default 180, at least 30).' },
  min_sent: { type: 'number', description: 'While the site emailed them at least this many times in those days (default 5).' },
};

const list = (v: unknown): string[] | undefined =>
  v === undefined || v === null ? undefined : (Array.isArray(v) ? v : [v]).map(String);

const json = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body) });

/** The prune rule as given, without unset keys. */
function rule(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['days', 'min_sent']) if (params[k] !== undefined && params[k] !== null) out[k] = params[k];
  return out;
}

export function siteSegmentsTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'tag_subscribers',
      description:
        'Add or remove tags on subscribers, one or many at once, by email or id. Tags are short labels you choose ' +
        '(e.g. "vip", "met at the book fair"), stored in lowercase; filter list_subscribers and segments by them. ' +
        'Tagging changes nothing else about a subscriber. Emails not on the list are reported, not added.',
      inputSchema: {
        type: 'object',
        properties: {
          emails: { type: 'array', items: { type: 'string' }, description: 'Subscribers by email (up to 10,000).' },
          member_ids: { type: 'array', items: { type: 'string' }, description: 'Subscribers by id (list_subscribers), instead of or with emails.' },
          add: { type: 'array', items: { type: 'string' }, description: 'Tags to put on them (up to 20; no commas, semicolons or |).' },
          remove: { type: 'array', items: { type: 'string' }, description: 'Tags to take off them (up to 20).' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = Object.fromEntries(
          Object.entries({ emails: list(params.emails), member_ids: list(params.member_ids), add: list(params.add), remove: list(params.remove) })
            .filter(([, v]) => v !== undefined),
        );
        const res = await publishFetch(config, '/sites/members/tags', onSite(params.site, json(body)));
        if (!res.ok) return apiError(res, 'Tags not changed');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_subscriber_tags',
      description: 'The tags in use on the site\'s subscribers, with how many subscribers have each (members: any status; active: still subscribed).',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/members/tags', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load tags');
        return res.json();
      },
    },

    {
      name: 'save_segment',
      description:
        'Save a named segment: a filter over the subscriber list that stays up to date (who matches is worked out each time ' +
        'it is used). Saving a name that exists replaces its filter. Active subscribers unless status says otherwise. ' +
        'Use it with list_subscribers, export_subscribers, get_subscriber_counts and email_subscribers (segment: its name).',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The segment\'s name, e.g. "Engaged paid readers".' },
          tier: { type: 'string', enum: TIERS, description: 'Only this kind of subscriber.' },
          status: { type: 'string', enum: STATUSES, description: 'Default active; "all" for every status.' },
          email_off: { type: 'boolean', description: 'true: only subscribers who turned emails off. false: only those who get emails.' },
          source: { type: 'string', description: 'Only subscribers who came from this source (import, manual, site, embed...).' },
          search: { type: 'string', description: 'Only subscribers whose email or name contains this.' },
          section: { type: 'string', description: 'Only subscribers who get this section, by name, slug or id (list_site_sections).' },
          tag: { type: 'string', description: 'Only subscribers with this tag.' },
          joined_after: { type: 'string', description: 'Subscribed on or after this date (ISO).' },
          joined_before: { type: 'string', description: 'Subscribed before this date (ISO).' },
          opened_within_days: { type: 'number', description: 'Opened or clicked an email from the site in the last this many days.' },
          not_opened_days: { type: 'number', description: 'Opened and clicked nothing from the site in the last this many days.' },
          ...SITE_PARAM,
        },
        required: ['name'],
      },
      handler: async (params) => {
        const body: Record<string, unknown> = {};
        for (const k of ['name', 'tier', 'status', 'email_off', 'source', 'search', 'tag', 'opened_within_days', 'not_opened_days']) {
          if (params[k] !== undefined && params[k] !== null && params[k] !== '') body[k] = params[k];
        }
        if (params.joined_after) body.from = params.joined_after;
        if (params.joined_before) body.to = params.joined_before;
        if (typeof params.section === 'string' && params.section.trim()) {
          const id = await resolveSection(config, params.site, params.section);
          if (id && typeof id === 'object') return id;
          if (id) body.section = id;
        }
        const res = await publishFetch(config, '/sites/segments', onSite(params.site, json(body)));
        if (!res.ok) return apiError(res, 'Segment not saved');
        const data = (await res.json()) as { segment: { name: string; count: number; description: string }; created: boolean };
        const s = data.segment;
        return {
          success: true,
          ...data,
          message: `${data.created ? 'Saved' : 'Updated'} the segment "${s.name}": ${s.description}. ${s.count.toLocaleString('en-US')} match now.`,
        };
      },
    },

    {
      name: 'list_segments',
      description: 'The saved segments, by name, each with its filter in plain words and how many subscribers match it now.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/segments', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load segments');
        return res.json();
      },
    },

    {
      name: 'delete_segment',
      description: 'Delete a saved segment by name. Only the saved filter goes; no subscriber is changed, and messages already sent to it keep its name.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'The segment\'s name (list_segments).' }, ...SITE_PARAM },
        required: ['name'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/segments/${encodeURIComponent(String(params.name ?? '').trim())}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Segment not deleted');
        const data = (await res.json()) as { name: string };
        return { success: true, deleted: true, name: data.name, message: `Deleted the segment "${data.name}".` };
      },
    },

    {
      name: 'get_paid_by_country',
      description:
        'How many paid subscribers the site has in each country, from the billing country Stripe knows (their address, ' +
        'else their card). Counts readers paying with their own card; comps and group seats are not included. unknown: ' +
        'paying readers with no country yet (filled at their next payment, or when you open them with get_subscriber).',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/members/countries', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not count paid subscribers by country');
        return res.json();
      },
    },

    {
      name: 'find_inactive_subscribers',
      description:
        'Find free subscribers who opened and clicked nothing from the site in `days` days (default 180) although it ' +
        'emailed them at least `min_sent` times (default 5): who prune_inactive_subscribers would remove. Returns the ' +
        'count, the first 50 (with emails sent and their last open), when you last asked them, and why pruning helps ' +
        'your emails reach the inbox. Paid, complimentary and founding subscribers, and subscribers who turned emails off, ' +
        'are never included. Changes nothing.',
      inputSchema: { type: 'object', properties: { ...RULE, ...SITE_PARAM } },
      handler: async (params) => {
        const q = new URLSearchParams(Object.entries(rule(params)).map(([k, v]) => [k, String(v)]));
        const res = await publishFetch(config, `/sites/members/inactive${q.toString() ? `?${q}` : ''}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not find inactive subscribers');
        return res.json();
      },
    },

    {
      name: 'ask_inactive_subscribers',
      description:
        'Before pruning, email the inactive subscribers (the same rule as find_inactive_subscribers) asking whether they ' +
        'still want your emails. Anyone who opens it or clicks its link stays; prune_inactive_subscribers waits 7 days ' +
        'after this so they can answer. Without subject and body a plain default is sent. Sent like email_subscribers ' +
        '(footer, unsubscribe link, the daily limit while in review). Run with dry_run first to see how many would get it.',
      inputSchema: {
        type: 'object',
        properties: {
          ...RULE,
          subject: { type: 'string', description: 'Default: "Do you still want emails from <site>?"' },
          body: { type: 'string', description: 'The message, in markdown or HTML. Default: a short note with a "Yes, keep sending me" link.' },
          dry_run: { type: 'boolean', description: 'Count who would get it and send nothing.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const payload: Record<string, unknown> = { ...rule(params) };
        if (typeof params.subject === 'string' && params.subject.trim()) payload.subject = params.subject;
        if (typeof params.body === 'string' && params.body.trim()) payload.body_html = md.render(params.body);
        if (params.dry_run !== undefined) payload.dry_run = params.dry_run;
        const res = await publishFetch(config, '/sites/members/inactive/ask', onSite(params.site, json(payload)));
        return sendAnswer(res, 'Not sent');
      },
    },

    {
      name: 'prune_inactive_subscribers',
      description:
        'Unsubscribe free subscribers who opened and clicked nothing in `days` days (default 180) although emailed at ' +
        'least `min_sent` times (default 5). REMOVES READERS: run with dry_run true first and tell the writer the count, ' +
        'then run with dry_run false only when they agree. Paid, complimentary and founding subscribers, and subscribers ' +
        'who turned emails off, are never removed; ' +
        'removed readers can subscribe again, and list_pruned_subscribers shows who went. Refused for 7 days after ' +
        'ask_inactive_subscribers so they can answer.',
      inputSchema: {
        type: 'object',
        properties: {
          ...RULE,
          dry_run: { type: 'boolean', description: 'true: count only. false: unsubscribe them.' },
          ...SITE_PARAM,
        },
        required: ['dry_run'],
      },
      handler: async (params) => {
        if (typeof params.dry_run !== 'boolean') return { error: 'Say dry_run: true to count first, or false to unsubscribe them.' };
        const res = await publishFetch(config, '/sites/members/prune', onSite(params.site, json({ ...rule(params), dry_run: params.dry_run })));
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          return { error: `Not pruned: ${(data.error as string) || res.statusText}`, ...(data.prune_from ? { prune_from: data.prune_from } : {}) };
        }
        return data.dry_run ? data : { success: true, ...data };
      },
    },

    {
      name: 'list_pruned_subscribers',
      description:
        'The readers removed by prune_inactive_subscribers, newest first: email, when, why (days without an open and ' +
        'emails sent), who on the team pruned them, and their status now (active if they subscribed again).',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many, up to 500 (default 100).' },
          offset: { type: 'number', description: 'Skip this many, for the next page.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const q = new URLSearchParams();
        for (const k of ['limit', 'offset']) if (params[k] !== undefined && params[k] !== null) q.set(k, String(params[k]));
        const res = await publishFetch(config, `/sites/members/pruned${q.toString() ? `?${q}` : ''}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load pruned subscribers');
        return res.json();
      },
    },
  ];
}
