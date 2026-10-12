import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, postImages, SITE_PARAM } from './site-tools.js';

/**
 * Guest authors (people credited on posts who are not on the team) and cross-posts (another
 * OpenWriter site's public post shown on this one). Listing guest authors is open to contributors;
 * everything else is for owners and admins.
 */

const seg = (s: unknown) => encodeURIComponent(String(s ?? '').trim());

const GUEST_FIELDS = {
  name: { type: 'string', description: 'Their name as the byline shows it, up to 100 characters. Required for a new guest author.' },
  bio: { type: 'string', description: 'A short bio for their page, up to 1000 characters. An empty string removes it.' },
  photo_url: {
    type: 'string',
    description: 'Their photo: an http(s) URL or a picture in this OpenWriter (/_images/...). An empty string removes it.',
  },
  link_url: { type: 'string', description: 'A link to their own site or profile, an http(s) address. An empty string removes it.' },
};

export function siteExtrasTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'list_guest_authors',
      description:
        'The site\'s guest authors: people credited on posts who are not on the team and have no account. Each has an id ' +
        '(pass it in publish_to_site authors), a name, bio, photo, link, the address of their page on the site (url) and how many posts name them.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/guest-authors', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load guest authors');
        return (await res.json()) as object;
      },
    },

    {
      name: 'save_guest_author',
      description:
        'Add a guest author, or change one (pass guest_author_id). A guest author is credited as a post\'s byline ' +
        '(publish_to_site authors: their id) and gets a page on the site with their bio, photo, link and posts. ' +
        'Their page address is made from the name once and stays when the name changes. Only the fields you pass change.',
      inputSchema: {
        type: 'object',
        properties: {
          guest_author_id: { type: 'string', description: 'The guest author to change (list_guest_authors). Leave out to add a new one.' },
          ...GUEST_FIELDS,
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body: Record<string, unknown> = pick(params, ['name', 'bio', 'photo_url', 'link_url']);
        const id = typeof params.guest_author_id === 'string' && params.guest_author_id.trim() ? params.guest_author_id.trim() : null;
        if (!id && !body.name) return { error: 'A new guest author needs a name.' };
        if (id && !Object.keys(body).length) return { error: 'Pass at least one field to change.' };
        // A photo on this computer is uploaded with the request, like a post's cover.
        const images = await postImages('', [params.photo_url]);
        if (images.length) body.images = images;
        const res = await publishFetch(config, id ? `/sites/guest-authors/${seg(id)}` : '/sites/guest-authors', onSite(params.site, {
          method: id ? 'PATCH' : 'POST', body: JSON.stringify(body),
        }));
        if (!res.ok) return apiError(res, 'Could not save the guest author');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'delete_guest_author',
      description:
        'Remove a guest author and their page. Posts that named them lose that byline; a post left with no author is credited to the owner. ' +
        'Only when the writer asks.',
      inputSchema: {
        type: 'object',
        properties: { guest_author_id: { type: 'string', description: 'The guest author to remove (list_guest_authors).' }, ...SITE_PARAM },
        required: ['guest_author_id'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/guest-authors/${seg(params.guest_author_id)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not remove the guest author');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'cross_post',
      description:
        'Show another OpenWriter site\'s post on this site: it appears on the homepage and has its own page here, credited to its site and authors, ' +
        'with a canonical link to the original for search engines. Only posts anyone can read in full, on sites that allow cross-posts. ' +
        'Nothing is emailed unless send_email is true: then subscribers get the note and a link to the original (never the post\'s text), once. ' +
        'Give the post\'s address (url), or its site\'s name (from_site) and slug.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The post\'s address, like https://name.openwriter.io/p/slug or one on the writer\'s own domain.' },
          from_site: { type: 'string', description: 'The other site\'s name (the part before .openwriter.io), with slug instead of url.' },
          slug: { type: 'string', description: 'The post\'s slug on that site, with from_site.' },
          note: { type: 'string', description: 'The writer\'s note shown above the post, and the email\'s text with send_email. Up to 2000 characters.' },
          send_email: { type: 'boolean', description: 'Also email the note and a link to every subscriber, as a message (default false).' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, ['url', 'from_site', 'slug', 'note', 'send_email']);
        const res = await publishFetch(config, '/sites/cross-posts', onSite(params.site, { method: 'POST', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not cross-post');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'list_cross_posts',
      description:
        'Posts from other sites shown on this site, newest first: title, where from, the original\'s address, the page here, the note, ' +
        'whether it was emailed, and live (false while the original is no longer public or its site stopped allowing cross-posts: readers do not see it).',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/cross-posts', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load cross-posts');
        return (await res.json()) as object;
      },
    },

    {
      name: 'remove_cross_post',
      description: 'Stop showing a cross-post on this site. Emails already sent stay sent; the original is not touched.',
      inputSchema: {
        type: 'object',
        properties: { cross_post_id: { type: 'string', description: 'The cross-post\'s id (list_cross_posts).' }, ...SITE_PARAM },
        required: ['cross_post_id'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/cross-posts/${seg(params.cross_post_id)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not remove the cross-post');
        return { success: true, ...((await res.json()) as object) };
      },
    },
  ];
}
