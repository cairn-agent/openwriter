import type { PluginMcpTool } from './helpers.js';
import { documentToEmail, extractLocalImages, getServerModules, publishFetch } from './helpers.js';
import { placeWall } from './site-wall.js';

const AUDIENCES = ['everyone', 'subscribers', 'paid', 'founding'];
const COMMENTS = [...AUDIENCES, 'off'];
const NOTICE_MODES = ['off', 'each', 'digest'];
/** Post-email extras the writer sets for all readers, or for free and paid readers apart. */
const EMAIL_PARTS = ['email_header', 'email_footer', 'email_banner'] as const;

/** Doc metadata key holding the post this doc was published as. */
const POST_KEY = 'sitePost';

export async function apiError(res: Response, what: string): Promise<{ error: string }> {
  const err = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
  return { error: `${what}: ${err.message || err.error || res.statusText}` };
}

/** The optional site parameter every site tool takes. */
export const SITE_PARAM = {
  site: {
    type: 'string',
    description: 'Site to act on, by name or id, for a site you are on the team of (list_my_sites). Leave out for the active profile\'s own site.',
  },
};

/** Request options that act on the given site (the X-Site header), or on the active profile's own site when none is given. */
export function onSite(site: unknown, options: RequestInit = {}): RequestInit {
  const s = typeof site === 'string' ? site.trim() : '';
  return s ? { ...options, headers: { ...(options.headers as Record<string, string>), 'X-Site': s } } : options;
}

/** Send only the fields the caller gave; the API refuses unknown keys and keeps what is left out. */
export function pick(params: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (params[k] !== undefined) out[k] = params[k];
  return out;
}

/**
 * Pictures stored on this computer that a request uses, in the body and as its image fields
 * (a cover, a social image, a wordmark), sent with it. The API uploads them and points the
 * request at the copies.
 */
export function postImages(html: string, imageFields: unknown[], dataDir?: string) {
  const local = imageFields.filter((u): u is string => typeof u === 'string' && u.startsWith('/_images/'));
  return extractLocalImages([html, ...local].join(' '), dataDir);
}

const FONTS = ['source-serif', 'literata', 'newsreader', 'playfair-display', 'inter', 'serif', 'sans', 'mono'];

const LINKS = (what: string) => ({
  type: 'array',
  description: `${what}, up to 6, replacing the current ones; an empty list removes them. Each url is an http(s) address or a path on the site starting with /.`,
  items: {
    type: 'object',
    properties: { label: { type: 'string', description: 'The link text, up to 40 characters.' }, url: { type: 'string' } },
    required: ['label', 'url'],
  },
});

/** The cover the desk shows for the document: the blog cover, else the article cover. */
export function docCover(meta: Record<string, any>): string | undefined {
  const cover = meta.blogContext?.coverImage || meta.articleContext?.coverImage;
  return typeof cover === 'string' && cover ? cover : undefined;
}

/**
 * The post page and the email already show the title above the body, so a document whose first
 * line is its title (how a new document gets its name) would show it twice. Drop that first block
 * when its text is the title.
 */
export function dropTitleLine(html: string, title: string): string {
  const first = /^\s*<(h[1-6]|p)>([\s\S]*?)<\/\1>\s*/.exec(html);
  if (!first) return html;
  // Compared by words only: the line often ends with a period the title does not have.
  const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const text = words(first[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  return text && text === words(title) ? html.slice(first[0].length) : html;
}

/** A site's id, for comparing two ways of naming a site (an id, a name, or none for the profile's own). */
async function siteIdOf(config: Record<string, string>, site: unknown): Promise<string | null> {
  const res = await publishFetch(config, '/sites', onSite(site));
  return res.ok ? (((await res.json()) as { site: { id: string } }).site.id ?? null) : null;
}

function postUrl(siteSlug: string | null | undefined, postSlug: string): string | null {
  return siteSlug ? `https://${siteSlug}.openwriter.io/p/${postSlug}` : null;
}

/** A section given by id, slug or name: its id, null for the main publication (empty string), or an error. */
export async function resolveSection(config: Record<string, string>, site: unknown, section: string): Promise<string | null | { error: string }> {
  if (!section.trim()) return null;
  const res = await publishFetch(config, '/sites/sections', onSite(site));
  if (!res.ok) return apiError(res, 'Could not load sections');
  const { sections } = (await res.json()) as { sections: { id: string; slug: string; name: string }[] };
  const want = section.trim().toLowerCase();
  const found = sections.find((s) => s.id === section || s.slug === want || s.name.toLowerCase() === want);
  if (found) return found.id;
  const names = sections.map((s) => s.name).join(', ');
  return { error: `No section "${section}". ${names ? `Sections: ${names}.` : 'The site has no sections yet; make one with save_site_section.'}` };
}

export function siteTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'claim_site_name',
      description:
        'Claim the free site address <name>.openwriter.io for the active profile, or rename it if one is already claimed. Reserved and taken names are refused.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The name before .openwriter.io: lowercase letters, numbers and hyphens.' },
          ...SITE_PARAM,
        },
        required: ['name'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/slug', onSite(params.site, {
          method: 'PUT',
          body: JSON.stringify({ slug: params.name }),
        }));
        if (!res.ok) return apiError(res, 'Could not claim that name');
        const { site } = (await res.json()) as { site: any };
        return { success: true, address: `https://${site.slug}.openwriter.io`, site };
      },
    },

    {
      name: 'get_site',
      description:
        'Show the active profile\'s site: address, name, tagline, about, logo, cover, publication settings (default audience, auto-paywall, double opt-in, welcome page and the welcome emails, comments, mailing address, the email header, footer and banner, reply-to, subscriber notices), ' +
        'design (accent_color, heading_font, body_font, wordmark_url, wordmark_dark_url, home_layout, nav_links, home_links), tracking (google_analytics_id, plausible_domain, block_ai_training) ' +
        'and reader switches (show_likes, show_bylines, comment_images, allow_cross_posts, language) in site.settings, the site\'s own terms and privacy pages (site.terms, site.privacy; null = none), ' +
        'sending (status "review" = new site that can email daily_cap people a day until OpenWriter approves it, see request_site_review; "active" = no daily limit; "suspended" = cannot send; review_requested_at = when review was last asked for), ' +
        'payments: whether Stripe is connected, the 7-day trial, and the paid plans (amounts in cents), ' +
        'and sender: who emails come from (from_name, from_email), where reader replies go (reply_to; reply_to_is_default = the owner\'s account email), ' +
        'the sending domain and its status (ready, waiting_for_dns, waiting_for_sender_verification; null = sent from <name>@mail.openwriter.io, see set_sending_domain) and the mailing address. ' +
        'role is your role on the site (owner, admin or contributor) and team_id your place on its team (null for the owner); payments and sender are shown to the owner and admins.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the site');
        const { site, role, team_id, payments, sender } = (await res.json()) as { site: any; role?: string; team_id?: string | null; payments?: unknown; sender?: unknown };
        const sending = {
          status: site.status,
          // The cap only limits sites in review; an approved site has none.
          daily_cap: site.status === 'review' ? site.daily_send_cap : null,
          review_requested_at: site.review_requested_at ?? null,
        };
        return { address: site.slug ? `https://${site.slug}.openwriter.io` : null, role, team_id: team_id ?? null, sending, site, payments, sender };
      },
    },

    {
      name: 'update_site',
      description: 'Update the site\'s details. Only the fields you pass change; an empty string clears an optional field.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Publication name shown on the site and in emails.' },
          tagline: { type: 'string', description: 'One-line description under the name.' },
          about: { type: 'string', description: 'About page content as HTML.' },
          logo_url: { type: 'string', description: 'Logo image: an http(s) URL or a picture in this OpenWriter (/_images/...).' },
          cover_url: { type: 'string', description: 'Cover image: an http(s) URL or a picture in this OpenWriter (/_images/...).' },
          terms: {
            type: 'string',
            description: 'The site\'s own Terms page as HTML, shown at /terms and linked in the footer. An empty string removes the page.',
          },
          privacy: {
            type: 'string',
            description: 'The site\'s own Privacy page as HTML, shown at /privacy and linked in the footer. An empty string removes the page.',
          },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body: Record<string, unknown> = pick(params, ['name', 'tagline', 'about', 'logo_url', 'cover_url', 'terms', 'privacy']);
        if (!Object.keys(body).length) return { error: 'Pass at least one field to change.' };
        // A picture on this computer is uploaded with the request, like a post's cover.
        const images = await postImages('', [params.logo_url, params.cover_url]);
        if (images.length) body.images = images;
        const res = await publishFetch(config, '/sites', onSite(params.site, { method: 'PATCH', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not update the site');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'update_site_settings',
      description:
        'Update publication settings, the site\'s design (accent colour, typefaces, wordmark, homepage layout, links) and tracking. Only the fields you pass change. A mailing address is required before the first email goes out. ' +
        'A private site is readable by approved subscribers only: readers ask to subscribe, and the writer approves or denies each request (list_subscribe_requests). ' +
        'Post emails can carry a header, footer and banner, the same for everyone or different for free and paid readers; they appear only in emails. ' +
        'A tracking ID adds that provider\'s tag to the site\'s pages only, never to emails or previews. ' +
        'The returned settings show the email parts as { free, paid } (null = none).',
      inputSchema: {
        type: 'object',
        properties: {
          default_audience: { type: 'string', enum: AUDIENCES, description: 'Audience new posts get when publish_to_site is not given one.' },
          auto_wall_after_days: { type: 'number', description: 'Public posts older than this many days become paid-only. 0 turns it off.' },
          double_opt_in: { type: 'boolean', description: 'New subscribers confirm by email before they are added.' },
          welcome_page: { type: 'boolean', description: 'Show first-time visitors a welcome page with a subscribe form.' },
          welcome_endorsements: {
            type: 'boolean',
            description: 'Show on the welcome page what other writers said when recommending this site (their blurb and name, up to three). On by default.',
          },
          recommendation_digest: {
            type: 'boolean',
            description: 'Email each new subscriber the sites this one recommends, a few days after they join. Never to imported or hand-added subscribers; one email each. Off by default.',
          },
          recommendation_digest_days: { type: 'number', description: 'Days after joining that the recommendation digest goes, 1 to 30 (default 3).' },
          welcome_email: { type: 'string', description: 'Plain text of the welcome email new free subscribers receive. An empty string restores the default.' },
          welcome_email_paid: { type: 'string', description: 'Plain text of the welcome email new paid (and comped) subscribers receive. An empty string restores the default.' },
          welcome_email_founding: { type: 'string', description: 'Plain text of the welcome email new founding members receive. An empty string restores the default.' },
          welcome_email_imported: { type: 'string', description: 'Plain text of the welcome email for imported subscribers. An empty string restores the default.' },
          comments_enabled: { type: 'boolean', description: 'Default for comments on new posts.' },
          mailing_address: { type: 'string', description: 'Postal address printed in every email.' },
          private: { type: 'boolean', description: 'Only approved subscribers can read the site; readers ask to subscribe and wait for approval.' },
          notify_subscribe_requests: { type: 'boolean', description: 'Email the writer when a reader asks to subscribe to a private site.' },
          author_name: { type: 'string', description: 'The owner\'s name as a post author and on the About page. An empty string clears it.' },
          email_header: { type: 'string', description: 'Short text at the top of every post email, for all readers. Simple markdown: **bold**, *italic*, [links](https://...). An empty string removes it.' },
          email_header_free: { type: 'string', description: 'The email header for free readers only (instead of email_header). An empty string removes it for them.' },
          email_header_paid: { type: 'string', description: 'The email header for paid readers only (paid, comped and founding). An empty string removes it for them.' },
          email_footer: { type: 'string', description: 'Short text at the end of every post email, for all readers. Same markdown as the header. An empty string removes it.' },
          email_footer_free: { type: 'string', description: 'The email footer for free readers only.' },
          email_footer_paid: { type: 'string', description: 'The email footer for paid readers only.' },
          email_banner: { type: 'string', description: 'Banner image at the top of every post email, an https URL, for all readers. An empty string removes it.' },
          email_banner_free: { type: 'string', description: 'The email banner for free readers only.' },
          email_banner_paid: { type: 'string', description: 'The email banner for paid readers only.' },
          reply_to: { type: 'string', description: 'Where reader replies to post and welcome emails go. An empty string goes back to the owner\'s account email.' },
          notify_free_subscribers: { type: 'string', enum: NOTICE_MODES, description: 'Email the owner (and admins who opt in) about new free subscribers: off, each (one email each) or digest (one a day). Default digest.' },
          notify_paid_subscribers: { type: 'string', enum: NOTICE_MODES, description: 'Email about new paid subscribers. Default each.' },
          notify_cancellations: { type: 'string', enum: NOTICE_MODES, description: 'Email about paid subscribers who cancel. Default each.' },
          accent_color: { type: 'string', description: 'Colour of buttons and links on the site and in its emails, as #rrggbb. Adjusted per theme so it stays readable. An empty string restores the default blue.' },
          heading_font: {
            type: 'string', enum: FONTS,
            description: 'Typeface for titles and headings: source-serif (default), literata, newsreader, playfair-display, inter, or the reader\'s own serif, sans or mono.',
          },
          body_font: { type: 'string', enum: FONTS, description: 'Typeface for post text and subtitles, from the same list.' },
          wordmark_url: {
            type: 'string',
            description: 'An image of the publication\'s name, shown at the top of the site instead of the name in type: an http(s) URL or a picture in this OpenWriter (/_images/...). Use a transparent PNG or SVG drawn for a light page. An empty string removes it.',
          },
          wordmark_dark_url: {
            type: 'string',
            description: 'The wordmark for the dark theme (light lettering). Without it, the dark theme shows the name in type. Same forms as wordmark_url.',
          },
          home_layout: {
            type: 'string', enum: ['magazine', 'list', 'grid'],
            description: 'Homepage: magazine (a featured post, then tiles and rows; default), list (every post as a row beside the sidebar), grid (every post as a picture tile, three across).',
          },
          nav_links: LINKS('Links added to the site\'s navigation, after the sections'),
          home_links: LINKS('Links shown on the homepage under the subscribe box, such as social profiles'),
          google_analytics_id: { type: 'string', description: 'Google Analytics 4 measurement ID (G-XXXXXXXXXX). An empty string removes the tag.' },
          plausible_domain: { type: 'string', description: 'The domain the site is registered under in Plausible (plausible.io), like example.com. An empty string removes the tag.' },
          block_ai_training: {
            type: 'boolean',
            description: 'Ask AI crawlers not to train on the site (robots.txt for the AI training crawlers, ai.txt and noai tags). Search engines and AI search still see it.',
          },
          show_likes: { type: 'boolean', description: 'Show like buttons and counts on posts (default true). Off hides them and stops new likes.' },
          show_bylines: { type: 'boolean', description: 'Show author names on posts, post lists and post emails (default true).' },
          comment_images: {
            type: 'boolean',
            description: 'Let signed-in readers attach one picture to a comment (default false). Pictures count against the owner\'s image storage; deleting the comment removes its picture.',
          },
          allow_cross_posts: {
            type: 'boolean',
            description: 'Let other OpenWriter sites cross-post this site\'s public posts, credited with a link back (default true). Off hides existing cross-posts at once.',
          },
          language: {
            type: 'string',
            description: 'The site\'s language as a code like en, fr or pt-BR (default en). Pages say it so browsers offer readers a translation, and post dates are written in it.',
          },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, [
          'default_audience', 'auto_wall_after_days', 'double_opt_in', 'welcome_page', 'welcome_endorsements', 'recommendation_digest',
          'recommendation_digest_days', 'welcome_email', 'welcome_email_paid',
          'welcome_email_founding', 'welcome_email_imported', 'comments_enabled', 'mailing_address', 'private',
          'notify_subscribe_requests', 'author_name', 'email_header', 'email_footer', 'email_banner', 'reply_to',
          'notify_free_subscribers', 'notify_paid_subscribers', 'notify_cancellations', 'accent_color', 'heading_font', 'body_font',
          'wordmark_url', 'wordmark_dark_url', 'home_layout', 'nav_links', 'home_links', 'google_analytics_id', 'plausible_domain', 'block_ai_training',
          'show_likes', 'show_bylines', 'comment_images', 'allow_cross_posts', 'language',
        ]);
        // One audience at a time: the other keeps what it has now.
        let current: Record<string, { free: string | null; paid: string | null }> | null = null;
        for (const part of EMAIL_PARTS) {
          const free = params[`${part}_free`];
          const paid = params[`${part}_paid`];
          if (free === undefined && paid === undefined) continue;
          if (params[part] !== undefined) return { error: `Pass ${part} for all readers, or ${part}_free and ${part}_paid, not both.` };
          if (free === undefined || paid === undefined) {
            if (!current) {
              const res = await publishFetch(config, '/sites/settings', onSite(params.site));
              if (!res.ok) return apiError(res, 'Could not load settings');
              current = ((await res.json()) as { settings: any }).settings;
            }
          }
          body[part] = { free: free ?? current?.[part]?.free ?? null, paid: paid ?? current?.[part]?.paid ?? null };
        }
        if (!Object.keys(body).length) return { error: 'Pass at least one setting to change.' };
        // A wordmark on this computer is uploaded with the request, like a post's pictures.
        const images = await postImages('', [params.wordmark_url, params.wordmark_dark_url]);
        if (images.length) body.images = images;
        const res = await publishFetch(config, '/sites/settings', onSite(params.site, { method: 'PATCH', body: JSON.stringify(body) }));
        if (!res.ok) return apiError(res, 'Could not update settings');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'publish_to_site',
      description:
        'Publish the active document as a post on the site, or update the post it was published as before. ' +
        'A line `<!-- paywall -->` in the document places the paywall: everything above it is the free preview for readers without access. ' +
        'At most one paywall per document; with none, a walled post shows nothing past the title to readers without access. ' +
        'Blocks are lines of their own: [paid-only] ... [/paid-only] and [free-only] ... [/free-only] (parts only paid readers, or only everyone else, see, on the site, in email and in RSS), ' +
        '[callout] ... [/callout] (a box), [drop-cap] (before a paragraph), [subscribe] (a subscribe button), and "[poll] Question" followed by a bulleted list of 2 to 6 choices (get_poll_results). ' +
        'A file from attach_file_to_post is its link on a line of its own. Broken markers are refused with what to fix. ' +
        'Pass publish_at to schedule instead of publishing now, and send_email to also email it to subscribers (a post is emailed once). ' +
        'On an update, settings you leave out keep their current values. ' +
        'A document published to a team site keeps going to that site; pass site to publish it somewhere else.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Post title. A new post defaults to the document title; an update keeps the current title.' },
          subtitle: { type: 'string', description: 'Subtitle under the title. An empty string clears it.' },
          slug: { type: 'string', description: 'URL slug (/p/<slug>). Defaults to one made from the title on first publish.' },
          cover_url: {
            type: 'string',
            description: 'Cover image: an http(s) URL or a picture in this OpenWriter (/_images/...). An empty string clears it.',
          },
          social_image_url: {
            type: 'string',
            description: 'The picture shown when the post is shared (link previews), if it should differ from the cover; 1200x630 works best. An http(s) URL or a picture in this OpenWriter (/_images/...). An empty string goes back to the cover.',
          },
          seo_description: {
            type: 'string',
            description: 'The description search engines and link previews show, up to 300 characters (about 155 show in search). An empty string goes back to the subtitle.',
          },
          audience: {
            type: 'string',
            enum: AUDIENCES,
            description: 'Who can read past the paywall: everyone, subscribers (free or paid), paid, or founding. Defaults to the site setting.',
          },
          web_only: { type: 'boolean', description: 'Publish on the site only; never email it.' },
          email_only: { type: 'boolean', description: 'Email only; keep it off the site.' },
          comments_audience: { type: 'string', enum: COMMENTS, description: 'Who may comment, or off.' },
          publish_at: { type: 'string', description: 'ISO date-time in the future to schedule the post instead of publishing now.' },
          draft: {
            type: 'boolean',
            description: 'Save the post on the site without publishing it, to preview it (preview_site_post), send a test email (send_test_email) or share it by secret link (get_post_share_link). Readers see nothing until it is published.',
          },
          send_email: {
            type: 'boolean',
            description: 'Also email the post to subscribers when it publishes. Each audience gets its own version. Subscribers who turned emails off are skipped (they still read it on the site).',
          },
          send_free_preview: {
            type: 'boolean',
            description: 'With send_email on a paid or founding post: also email free subscribers the preview above the paywall.',
          },
          subject_b: {
            type: 'string',
            description: 'With send_email: a second subject line to test against the title. A share of recipients (ab_test_percent) get one or the other; ' +
              'after the wait the subject with the higher open rate goes to everyone else. Needs at least 200 recipients. Results are in the post\'s stats (subject_test).',
          },
          ab_test_percent: {
            type: 'number',
            description: 'With subject_b: the share of recipients in the test, split evenly between the two subjects, 10 to 50 (default 20).',
          },
          ab_test_wait_minutes: {
            type: 'number',
            description: 'With subject_b: minutes to wait before sending the winning subject to the rest, 30 to 240 (default 60).',
          },
          section: {
            type: 'string',
            description: 'Section the post belongs to, by name, slug or id (list_site_sections). An empty string puts it in the main publication.',
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Tag names, up to 20, replacing the post\'s tags. Names that are not tags yet become new tags.',
          },
          authors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Who the post is by, up to 10: "owner" for the site owner, ids of team members who accepted (list_site_team), or guest author ids (list_guest_authors). New posts by a team member default to them.',
          },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const server = await getServerModules();
        const meta = server.getMetadata() || {};
        const site = (params.site as string | undefined) ?? meta[POST_KEY]?.site;
        const { html: docHtml, subject } = await documentToEmail();
        const html = dropTitleLine(docHtml, subject);
        if (!html.trim()) return { error: 'The document is empty.' };

        // One document is one post on one site. Naming another site would make a second post there
        // (the recorded one is not found on it) and leave this document pointing at the new one.
        const recorded = meta[POST_KEY];
        if (recorded?.id && params.site !== undefined && params.site !== recorded.site) {
          const [asked, own] = await Promise.all([siteIdOf(config, params.site), siteIdOf(config, recorded.site)]);
          if (asked && own && asked !== own) {
            const there = await publishFetch(config, `/sites/posts/${recorded.id}`, onSite(recorded.site));
            if (there.ok) {
              return { error: `This document is already a post on ${recorded.url ? new URL(recorded.url).host : 'another site'}. Switch to that site to update it, or copy the document to publish it on this one.` };
            }
          }
        }

        const wall = placeWall(html);
        if (!wall.ok) return { error: wall.error };
        // No cover passed: use the document's own cover. An empty string still clears it.
        const coverUrl = params.cover_url ?? docCover(meta);
        const images = await postImages(wall.html, [coverUrl, params.social_image_url]);

        let section: Record<string, unknown> = {};
        if (typeof params.section === 'string') {
          const id = await resolveSection(config, site, params.section);
          if (id && typeof id === 'object') return id;
          section = { section_id: id };
        }

        if (params.draft && (params.publish_at || params.send_email)) {
          return { error: 'A draft is not scheduled or emailed. Leave out draft to publish, schedule or send.' };
        }
        if (!params.send_email && (params.subject_b || params.ab_test_percent !== undefined || params.ab_test_wait_minutes !== undefined)) {
          return { error: 'A subject line test runs on the email: pass send_email with subject_b.' };
        }

        // Update the post this doc was published as, unless it has since been deleted.
        let existingId: string | null = meta[POST_KEY]?.id ?? null;
        if (existingId) {
          const check = await publishFetch(config, `/sites/posts/${existingId}`, onSite(site));
          if (check.status === 404) existingId = null;
          else if (!check.ok) return apiError(check, 'Could not load the existing post');
          else if (params.draft) {
            const { post: current } = (await check.json()) as { post: { status: string } };
            if (current.status !== 'draft') {
              return { error: `This post is ${current.status === 'published' ? 'already published, so saving it updates what readers see' : 'scheduled'}. Unpublish it first (unpublish_site_post) to work on it as a draft.` };
            }
          }
        }

        const fields: Record<string, unknown> = {
          // A new post takes the doc title; an update keeps the post's title unless one is passed.
          ...(params.title || !existingId ? { title: (params.title as string) || subject } : {}),
          body_html: wall.html,
          wall_at: wall.wall_at,
          ...pick({ ...params, cover_url: coverUrl }, [
            'subtitle', 'slug', 'cover_url', 'social_image_url', 'seo_description', 'audience', 'web_only', 'email_only',
            'comments_audience', 'tags', 'authors',
          ]),
          ...section,
          ...(params.draft ? { status: 'draft' } : params.publish_at ? { status: 'scheduled', publish_at: params.publish_at } : { status: 'published' }),
          ...(images.length ? { images } : {}),
        };
        const res = existingId
          ? await publishFetch(config, `/sites/posts/${existingId}`, onSite(site, { method: 'PATCH', body: JSON.stringify(fields) }))
          : await publishFetch(config, '/sites/posts', onSite(site, { method: 'POST', body: JSON.stringify(fields) }));
        if (!res.ok) return apiError(res, existingId ? 'Update failed' : 'Publish failed');
        const { post } = (await res.json()) as { post: any };

        const siteRes = await publishFetch(config, '/sites', onSite(site));
        const siteSlug = siteRes.ok ? ((await siteRes.json()) as { site: any }).site.slug : null;
        const url = postUrl(siteSlug, post.slug);

        server.setMetadata({ [POST_KEY]: { id: post.id, slug: post.slug, status: post.status, url, ...(site ? { site } : {}) } });
        server.save();
        server.broadcastMetadataChanged(server.getMetadata());

        const result: Record<string, unknown> = {
          success: true,
          action: existingId ? 'updated' : 'created',
          post_id: post.id,
          status: post.status,
          publish_at: post.publish_at,
          audience: post.audience,
          wall_at: post.wall_at,
          section_id: post.section_id,
          social_image_url: post.social_image_url,
          seo_description: post.seo_description,
          tags: post.tags,
          authors: post.authors,
          url,
        };
        if (site) result.site = site;
        if (!siteSlug) result.note = 'The site has no name yet, so it is not served. Claim one with claim_site_name.';
        else if (wall.wall_at !== null && post.audience === 'everyone') {
          result.note = 'The paywall marker has no effect while the audience is everyone.';
        }

        if (params.send_email) {
          const send = await publishFetch(config, `/sites/posts/${post.id}/send`, onSite(site, {
            method: 'POST',
            body: JSON.stringify(pick(params, ['send_free_preview', 'subject_b', 'ab_test_percent', 'ab_test_wait_minutes'])),
          }));
          if (!send.ok) {
            result.email = (await apiError(send, 'Post saved, but the email was not sent')).error;
          } else {
            const s = (await send.json()) as {
              scheduled?: boolean; recipients?: number; issue_id?: string; free_preview?: boolean; send_free_preview?: boolean;
              subject_test?: { subject_b: string; percent: number; wait_minutes: number; test_recipients?: number; decide_at?: string } | null;
            };
            const preview = s.free_preview || s.send_free_preview ? ' Free subscribers get the preview.' : '';
            const t = s.subject_test;
            const test = !t ? '' : t.test_recipients !== undefined
              ? ` Subject line test: ${t.test_recipients} get the title or "${t.subject_b}" now; the one opened more goes to the rest after ${t.wait_minutes} minutes.`
              : ` Subject line test: ${t.percent}% get the title or "${t.subject_b}"; the one opened more goes to the rest ${t.wait_minutes} minutes later.`;
            result.email = (s.scheduled ? 'Will be emailed when the post publishes.' : `Sending to ${s.recipients} subscribers.`) + preview + test;
            if (s.issue_id) result.issue_id = s.issue_id;
            if (t) result.subject_test = t;
          }
        }
        return result;
      },
    },

    {
      name: 'unpublish_site_post',
      description: 'Take the active document\'s site post off the site (it becomes a draft). Emails already sent are not recalled.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Post to unpublish. Defaults to the post the active document was published as.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const server = await getServerModules();
        const meta = server.getMetadata() || {};
        const id = (params.post_id as string) || meta[POST_KEY]?.id;
        if (!id) return { error: 'This document has not been published to the site. Pass post_id to unpublish another post.' };
        // The doc's own post lives on the site it was published to.
        const site = params.site ?? (params.post_id ? undefined : meta[POST_KEY]?.site);
        const res = await publishFetch(config, `/sites/posts/${id}/unpublish`, onSite(site, { method: 'POST' }));
        if (!res.ok) return apiError(res, 'Unpublish failed');
        const { post } = (await res.json()) as { post: any };
        if (meta[POST_KEY]?.id === id) {
          server.setMetadata({ [POST_KEY]: { ...meta[POST_KEY], status: post.status } });
          server.save();
          server.broadcastMetadataChanged(server.getMetadata());
        }
        return { success: true, post_id: post.id, status: post.status };
      },
    },

    {
      name: 'get_site_stats',
      description:
        'Site numbers: subscriber counts by type and status, site totals, revenue, and stats for one post: post_id (any post, ' +
        'by id or slug), else the active document\'s post if it has one. A post\'s stats are views, subscribers gained after it ' +
        'was published and, once emailed, recipients, opens, clicks and unsubscribes with open_rate, click_rate and ' +
        'unsubscribe_rate (percent of recipients), and subject_test (each subject\'s sent, opens and open rate and the winner) when it was emailed with subject_b. ' +
        'Revenue (site.revenue) gives paid members by plan, how many are in a free trial, comps, monthly recurring revenue, ' +
        'OpenWriter\'s 5% fee and what the writer keeps, in cents of the plans\' currency.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'A post\'s id or slug (from list_site_posts). Leave out for the active document\'s post.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const server = await getServerModules();
        const docPost = server.getMetadata()?.[POST_KEY];
        const asked = typeof params.post_id === 'string' && params.post_id.trim() ? params.post_id.trim() : undefined;
        // The doc's post counts only when it lives on the site asked about.
        const postId = asked ?? ((docPost?.site ?? '') === ((params.site as string | undefined) ?? '') ? (docPost?.id as string | undefined) : undefined);
        const [stats, counts, post] = await Promise.all([
          publishFetch(config, '/sites/stats', onSite(params.site)),
          publishFetch(config, '/sites/members/counts', onSite(params.site)),
          postId ? publishFetch(config, `/sites/posts/${encodeURIComponent(postId)}/stats`, onSite(params.site)) : Promise.resolve(null),
        ]);
        if (!stats.ok) return apiError(stats, 'Could not load site stats');
        if (!counts.ok) return apiError(counts, 'Could not load member counts');
        if (asked && !post?.ok) return post?.status === 404 ? { error: `No post "${asked}" on this site.` } : apiError(post!, 'Could not load the post\'s stats');
        const out: Record<string, unknown> = {
          site: ((await stats.json()) as { stats: unknown }).stats,
          members: ((await counts.json()) as { counts: unknown }).counts,
        };
        if (post?.ok) {
          const { post: p, stats: s } = (await post.json()) as { post: { id: string; title: string; slug: string; status: string; published_at: string | null }; stats: object };
          out.post = { post_id: p.id, title: p.title, slug: p.slug, status: p.status, published_at: p.published_at, ...s };
        }
        return out;
      },
    },
  ];
}
