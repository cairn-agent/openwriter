import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, SITE_PARAM } from './site-tools.js';

/**
 * Comment moderation and reader bans on the writer's site. Owners and admins only;
 * a contributor gets a refusal from the API.
 */

const COMMENT_STATUSES = ['visible', 'deleted', 'all'];

const COMMENT_ID = { comment_id: { type: 'string', description: 'The comment\'s id, from list_site_comments.' } };

interface ApiComment {
  id: string;
  post_id: string;
  post_title: string;
  body: string;
  status: string;
  pinned: boolean;
  report_count: number;
  created_at: string;
  reader_name: string | null;
  reader_email: string;
}

const seg = (s: string) => encodeURIComponent(String(s ?? '').trim());

export function siteModerationTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'list_site_comments',
      description:
        'List comments readers left on the site\'s posts, newest first, with the post, the reader (name and email), ' +
        'whether it is pinned and how many times readers reported it. reported: true lists only reported comments, ' +
        'most reported first: the moderation queue, where each one is approved (approve_site_comment) or deleted (delete_site_comment).',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Only comments on this post (its id, as each comment\'s post_id shows).' },
          reported: { type: 'boolean', description: 'Only comments readers reported.' },
          status: { type: 'string', enum: COMMENT_STATUSES, description: 'visible (default), deleted, or all.' },
          limit: { type: 'number', description: 'Max comments to return (default 50, at most 200).' },
          offset: { type: 'number', description: 'Pagination offset (default 0).' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const q = new URLSearchParams();
        if (typeof params.post_id === 'string' && params.post_id.trim()) q.set('post_id', params.post_id.trim());
        if (params.reported === true) q.set('reported', '1');
        for (const k of ['status', 'limit', 'offset']) if (params[k] !== undefined && params[k] !== null) q.set(k, String(params[k]));
        const query = q.toString();
        const res = await publishFetch(config, `/sites/comments${query ? `?${query}` : ''}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load comments');
        const { comments } = (await res.json()) as { comments: ApiComment[] };
        return {
          comments: comments.map((c) => ({
            id: c.id, post_id: c.post_id, post_title: c.post_title, body: c.body, status: c.status, pinned: c.pinned,
            report_count: c.report_count, created_at: c.created_at, reader: { name: c.reader_name, email: c.reader_email },
          })),
        };
      },
    },

    {
      name: 'delete_site_comment',
      description:
        'Take a comment down: readers no longer see it, and it leaves the reported list. Replies under it stay. ' +
        'It cannot be put back, so delete only what the writer asked to remove.',
      inputSchema: { type: 'object', properties: { ...COMMENT_ID, ...SITE_PARAM }, required: ['comment_id'] },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/comments/${seg(params.comment_id as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not delete the comment');
        return { success: true, deleted: true, comment_id: params.comment_id };
      },
    },

    {
      name: 'pin_site_comment',
      description: 'Pin a comment to the top of its post\'s comments, or unpin it (pinned: false).',
      inputSchema: {
        type: 'object',
        properties: { ...COMMENT_ID, pinned: { type: 'boolean', description: 'true to pin, false to unpin.' }, ...SITE_PARAM },
        required: ['comment_id', 'pinned'],
      },
      handler: async (params) => {
        if (typeof params.pinned !== 'boolean') return { error: 'pinned must be true or false.' };
        const action = params.pinned ? 'pin' : 'unpin';
        const res = await publishFetch(config, `/sites/comments/${seg(params.comment_id as string)}/${action}`, onSite(params.site, { method: 'POST' }));
        if (!res.ok) return apiError(res, `Could not ${action} the comment`);
        return { success: true, comment_id: params.comment_id, pinned: params.pinned };
      },
    },

    {
      name: 'approve_site_comment',
      description:
        'Approve a reported comment: its reports are cleared, so it leaves the reported list, and it stays up. ' +
        'A later report puts it back on the list.',
      inputSchema: { type: 'object', properties: { ...COMMENT_ID, ...SITE_PARAM }, required: ['comment_id'] },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/comments/${seg(params.comment_id as string)}/approve`, onSite(params.site, { method: 'POST' }));
        if (!res.ok) return apiError(res, 'Could not approve the comment');
        return { success: true, comment_id: params.comment_id, approved: true, report_count: 0 };
      },
    },

    {
      name: 'ban_readers',
      description:
        'Ban readers from the site by email, one or up to 500 at once. A banned reader can no longer comment, like or report ' +
        'comments, and cannot subscribe by any route (the site, the signup embed, paid checkout, gifts, groups, private-site requests). ' +
        'Their free subscription ends now, so they stop getting emails. A ban does NOT cancel paid access: anyone in ' +
        'paid_access_kept keeps it until the writer refunds or cancels them in Stripe, or ends their comp (end_comp). ' +
        'delete_comments: true also takes down every comment they left on this site. Only ban whom the writer named. ' +
        'Returns who was banned, already_banned, invalid entries, who was unsubscribed, paid_access_kept, requests_denied and comments_deleted.',
      inputSchema: {
        type: 'object',
        properties: {
          emails: { type: 'array', items: { type: 'string' }, description: 'Email addresses to ban (1 to 500). Repeats and case do not matter.' },
          reason: { type: 'string', description: 'A note for the writer\'s own records, up to 500 characters. Readers never see it.' },
          delete_comments: { type: 'boolean', description: 'Also delete every comment they left on this site (default false).' },
          ...SITE_PARAM,
        },
        required: ['emails'],
      },
      handler: async (params) => {
        const emails = typeof params.emails === 'string' ? [params.emails] : params.emails;
        if (!Array.isArray(emails) || !emails.length) return { error: 'Pass emails: a list of 1 to 500 email addresses.' };
        const body = { ...pick(params, ['reason', 'delete_comments']), emails };
        const res = await publishFetch(config, '/sites/bans', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not ban');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'unban_reader',
      description:
        'Lift a ban: the reader may comment and subscribe again. Nobody is re-subscribed for them; they subscribe again themselves.',
      inputSchema: {
        type: 'object',
        properties: { email: { type: 'string', description: 'The banned email.' }, ...SITE_PARAM },
        required: ['email'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/bans/${seg(params.email as string)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not unban');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_banned_readers',
      description: 'The emails banned from the site, newest first, with the writer\'s reason and when. total counts every ban.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max bans to return (default 100, at most 500).' },
          offset: { type: 'number', description: 'Pagination offset (default 0).' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const q = new URLSearchParams();
        for (const k of ['limit', 'offset']) if (params[k] !== undefined && params[k] !== null) q.set(k, String(params[k]));
        const query = q.toString();
        const res = await publishFetch(config, `/sites/bans${query ? `?${query}` : ''}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the ban list');
        return (await res.json()) as object;
      },
    },
  ];
}
