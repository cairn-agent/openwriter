import type { PluginMcpTool } from './helpers.js';
import { md, publishFetch } from './helpers.js';
import { apiError, onSite, resolveSection, SITE_PARAM } from './site-tools.js';

/**
 * Email beyond a post's own send: a message to one subscriber or a group (never shown on
 * the site), the list of past messages, and a post resent once to who did not open it.
 * Each sending tool takes dry_run to see how many would get it first.
 */

const TIERS = ['free', 'paid', 'founding', 'comp'];

/** The API's answer as the tool's result; a refusal keeps its plain sentence (and when it can be done). */
async function sendAnswer(res: Response, what: string): Promise<Record<string, unknown>> {
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      error: `${what}: ${(data.message as string) || (data.error as string) || res.statusText}`,
      ...(data.available_at ? { available_at: data.available_at } : {}),
    };
  }
  return data.dry_run ? data : { success: true, ...data };
}

export function siteSendingTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'email_subscribers',
      description:
        'Email one subscriber, or a group of subscribers, a message that is not a post: it is never shown on the site. ' +
        'Give email or member_id for one person, or any of tier, section and search for a group; with none of them it goes to every active subscriber. ' +
        'Only active subscribers are emailed. It carries the site\'s mailing address and an unsubscribe link, counts against the daily limit ' +
        'while the site is in review, and is listed by list_sent_messages. Run with dry_run first: it returns how many would get it and sends nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'The subject line.' },
          body: { type: 'string', description: 'The message, in markdown or HTML. Cleaned like a post body.' },
          email: { type: 'string', description: 'One subscriber, by email.' },
          member_id: { type: 'string', description: 'One subscriber, by id (list_subscribers).' },
          tier: { type: 'string', enum: TIERS, description: 'Only subscribers of this kind: free, paid, founding or comp.' },
          section: { type: 'string', description: 'Only subscribers who get this section, by name, slug or id (list_site_sections).' },
          search: { type: 'string', description: 'Only subscribers whose email or name contains this.' },
          dry_run: { type: 'boolean', description: 'Count who would get it and send nothing.' },
          ...SITE_PARAM,
        },
        required: ['subject', 'body'],
      },
      handler: async (params) => {
        if (typeof params.body !== 'string' || !params.body.trim()) return { error: 'The message needs a body.' };
        const payload: Record<string, unknown> = { subject: params.subject, body_html: md.render(params.body) };
        for (const k of ['email', 'member_id', 'tier', 'search', 'dry_run']) if (params[k] !== undefined) payload[k] = params[k];
        if (typeof params.section === 'string' && params.section.trim()) {
          const id = await resolveSection(config, params.site, params.section);
          if (id && typeof id === 'object') return id;
          if (id) payload.section_id = id;
        }
        const res = await publishFetch(config, '/sites/messages', onSite(params.site, { method: 'POST', body: JSON.stringify(payload) }));
        return sendAnswer(res, 'Not sent');
      },
    },

    {
      name: 'list_sent_messages',
      description:
        'The messages sent with email_subscribers, newest first: subject, who it went to (an email, or a group such as "Paid subscribers in Fiction"), ' +
        'who on the team sent it and when, how many it was addressed to, how many were delivered and how many opened. Posts are not listed here.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many, up to 200 (default 50).' },
          offset: { type: 'number', description: 'Skip this many, for the next page.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const q = new URLSearchParams();
        q.set('limit', String(Math.min(200, Math.max(1, Number(params.limit) || 50))));
        if (params.offset) q.set('offset', String(Math.max(0, Number(params.offset) || 0)));
        const res = await publishFetch(config, `/sites/messages?${q}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not list messages');
        return res.json();
      },
    },

    {
      name: 'resend_post_to_unopened',
      description:
        'Email an emailed post again to the people who got it and did not open it, still subscribed and still in its audience. ' +
        'A post is resent once, and only from 24 hours after it was emailed (a refusal says when). A new subject is optional. ' +
        'Run with dry_run first: it returns how many would get it and sends nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'The post to resend (list_site_posts).' },
          subject: { type: 'string', description: 'A new subject line. Default: the subject it was first sent with.' },
          dry_run: { type: 'boolean', description: 'Count who would get it and send nothing.' },
          ...SITE_PARAM,
        },
        required: ['post_id'],
      },
      handler: async (params) => {
        const body: Record<string, unknown> = {};
        if (typeof params.subject === 'string' && params.subject.trim()) body.subject = params.subject;
        if (params.dry_run !== undefined) body.dry_run = params.dry_run;
        const res = await publishFetch(config, `/sites/posts/${encodeURIComponent(String(params.post_id))}/resend`, onSite(params.site, {
          method: 'POST',
          body: JSON.stringify(body),
        }));
        return sendAnswer(res, 'Not resent');
      },
    },
  ];
}
