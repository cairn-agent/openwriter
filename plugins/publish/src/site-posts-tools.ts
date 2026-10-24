import type { PluginMcpTool } from './helpers.js';
import { getServerModules, publishFetch } from './helpers.js';
import { SITE_PARAM, apiError, onSite, pick } from './site-tools.js';

const STATUSES = ['draft', 'scheduled', 'published'];
const PREVIEW_AS = ['visitor', 'free', 'paid', 'founding'];

/** The site post the active document was published or saved as, if any. */
async function docPost(): Promise<{ id?: string; site?: string; title?: string } | undefined> {
  const server = await getServerModules();
  return server.getMetadata()?.sitePost;
}

/** post_id as given, else the active document's post; site follows the doc's post when post_id is left out. */
async function target(params: Record<string, unknown>): Promise<{ id: string; site: unknown } | { error: string }> {
  if (typeof params.post_id === 'string' && params.post_id) return { id: params.post_id, site: params.site };
  const own = await docPost();
  if (own?.id) return { id: own.id, site: params.site ?? own.site };
  return { error: 'This document is not on the site yet. Save it first with publish_to_site (draft: true keeps it unpublished), or pass post_id.' };
}

function postUrl(siteSlug: string | null, slug: string): string | null {
  return siteSlug ? `https://${siteSlug}.openwriter.io/p/${slug}` : null;
}

export function sitePostsTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'list_site_posts',
      description:
        'List the site\'s posts, newest first: drafts saved on the site, scheduled and published posts, each with its address and, ' +
        'for those who manage the site, its stats (views, recipients, opens, clicks, subscribers gained, and subject_test with each ' +
        'subject\'s results when it was emailed with a subject line test), and its authors (each with id and name; a guest author also has guest).',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUSES, description: 'Only posts with this status.' },
          limit: { type: 'number', description: 'How many, up to 100 (default 50).' },
          offset: { type: 'number', description: 'Skip this many, for the next page.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const q = new URLSearchParams();
        if (params.status) q.set('status', String(params.status));
        q.set('limit', String(Math.min(100, Math.max(1, Number(params.limit) || 50))));
        if (params.offset) q.set('offset', String(Math.max(0, Number(params.offset) || 0)));
        const [res, siteRes] = await Promise.all([
          publishFetch(config, `/sites/posts?${q}`, onSite(params.site)),
          publishFetch(config, '/sites', onSite(params.site)),
        ]);
        if (!res.ok) return apiError(res, 'Could not list posts');
        const slug = siteRes.ok ? ((await siteRes.json()) as { site: any }).site.slug ?? null : null;
        const { posts } = (await res.json()) as { posts: any[] };
        return {
          posts: posts.map((p) => ({
            id: p.id, title: p.title, subtitle: p.subtitle, slug: p.slug, status: p.status, audience: p.audience, pinned: p.pinned,
            web_only: p.web_only, email_only: p.email_only, publish_at: p.publish_at, published_at: p.published_at, emailed_at: p.emailed_at,
            updated_at: p.updated_at, section_id: p.section_id, tags: p.tags, authors: p.authors, cover_url: p.cover_url,
            url: p.status === 'published' && !p.email_only ? postUrl(slug, p.slug) : null,
            ...(p.stats ? { stats: p.stats } : {}),
          })),
        };
      },
    },

    {
      name: 'delete_site_post',
      description:
        'Delete a post from the site for good: its page goes and it leaves the archive. Emails already sent stay sent. ' +
        'The document in OpenWriter is not touched. To take a post down but keep it, use unpublish_site_post.',
      inputSchema: {
        type: 'object',
        properties: { post_id: { type: 'string', description: 'The post to delete (list_site_posts).' }, ...SITE_PARAM },
        required: ['post_id'],
      },
      handler: async (params) => {
        const got = await publishFetch(config, `/sites/posts/${params.post_id}`, onSite(params.site));
        if (!got.ok) return apiError(got, 'Could not find the post');
        const { post } = (await got.json()) as { post: any };
        const res = await publishFetch(config, `/sites/posts/${params.post_id}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Delete failed');
        return { success: true, deleted: true, post_id: post.id, title: post.title, message: `Deleted "${post.title}".` };
      },
    },

    {
      name: 'pin_site_post',
      description: 'Pin a published post to the top of the site\'s homepage, or unpin it.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'The post (list_site_posts).' },
          pinned: { type: 'boolean', description: 'true to pin, false to unpin.' },
          ...SITE_PARAM,
        },
        required: ['post_id', 'pinned'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/posts/${params.post_id}/${params.pinned ? 'pin' : 'unpin'}`, onSite(params.site, { method: 'POST' }));
        if (!res.ok) return apiError(res, params.pinned ? 'Pin failed' : 'Unpin failed');
        const { post } = (await res.json()) as { post: any };
        return { success: true, post_id: post.id, title: post.title, pinned: post.pinned };
      },
    },

    {
      name: 'preview_site_post',
      onOpenDocument: true,
      description:
        'The post exactly as one kind of reader would get it, as its web page or its email: visitor (not subscribed), free, paid or founding. ' +
        'Returns the full HTML (for showing on a screen) with base_url for its links. Works on drafts without publishing them. ' +
        'Defaults to the active document\'s post. To check a post yourself, send_test_email is usually better.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'The post. Defaults to the active document\'s post.' },
          as: { type: 'string', enum: PREVIEW_AS, description: 'Which reader (default visitor).' },
          format: { type: 'string', enum: ['web', 'email'], description: 'The web page or the email (default web).' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const t = await target(params);
        if ('error' in t) return t;
        const q = new URLSearchParams(pick(params, ['as', 'format']) as Record<string, string>);
        const res = await publishFetch(config, `/sites/posts/${t.id}/preview?${q}`, onSite(t.site));
        if (!res.ok) return apiError(res, 'Preview failed');
        return { post_id: t.id, ...((await res.json()) as object) };
      },
    },

    {
      name: 'send_test_email',
      onOpenDocument: true,
      description:
        'Email the post to yourself (the signed-in writer only), marked [Test], as a free, paid or founding reader would get it. ' +
        'Works on drafts without publishing or emailing anyone else. Defaults to the active document\'s post, as a paid reader.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'The post. Defaults to the active document\'s post.' },
          as: { type: 'string', enum: ['free', 'paid', 'founding'], description: 'Which version (default paid).' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const t = await target(params);
        if ('error' in t) return t;
        const res = await publishFetch(config, `/sites/posts/${t.id}/test-email`, onSite(t.site, {
          method: 'POST', body: JSON.stringify(pick(params, ['as'])),
        }));
        if (!res.ok) return apiError(res, 'The test email was not sent');
        const r = (await res.json()) as { sent_to: string; subject: string; as: string; note?: string };
        return { success: true, ...r, message: `Sent "${r.subject}" to ${r.sent_to}.` };
      },
    },

    {
      name: 'get_post_share_link',
      onOpenDocument: true,
      description:
        'A secret link to an unpublished post, to share a draft before publishing: anyone with it reads the whole draft (it is not listed or indexed). ' +
        'Once the post is published this returns its normal address. Defaults to the active document\'s post.',
      inputSchema: {
        type: 'object',
        properties: { post_id: { type: 'string', description: 'The post. Defaults to the active document\'s post.' }, ...SITE_PARAM },
      },
      handler: async (params) => {
        const t = await target(params);
        if ('error' in t) return t;
        const res = await publishFetch(config, `/sites/posts/${t.id}/share-link`, onSite(t.site));
        if (!res.ok) return apiError(res, 'Could not make the link');
        return { post_id: t.id, ...((await res.json()) as object) };
      },
    },

    {
      name: 'revoke_post_share_link',
      onOpenDocument: true,
      description: 'Stop a draft\'s secret link working. Asking for a link again later gives a new one.',
      inputSchema: {
        type: 'object',
        properties: { post_id: { type: 'string', description: 'The post. Defaults to the active document\'s post.' }, ...SITE_PARAM },
      },
      handler: async (params) => {
        const t = await target(params);
        if ('error' in t) return t;
        const res = await publishFetch(config, `/sites/posts/${t.id}/share-link`, onSite(t.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not revoke the link');
        return { success: true, post_id: t.id, revoked: true };
      },
    },
  ];
}
