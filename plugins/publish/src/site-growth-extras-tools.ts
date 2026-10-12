import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, SITE_PARAM } from './site-tools.js';

/**
 * QR codes for the site's links, and the perks paid subscribers get. Owners and admins only;
 * a contributor gets a refusal from the API.
 */

const QR_TARGETS = ['subscribe', 'post', 'offer'];

interface ApiPerk {
  id: string;
  text: string;
  link: string | null;
  code: string | null;
  created_at: string;
}

const PERK_ID = { perk_id: { type: 'string', description: 'The perk\'s id, from list_perks.' } };
const seg = (s: unknown) => encodeURIComponent(String(s ?? '').trim());

export function siteGrowthExtrasTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'get_qr_code',
      description:
        'A QR code for one of the site\'s links, to print on a flyer, a slide or a book: the subscribe page, a published post or an offer\'s link. ' +
        'Returns the link it opens, the code as an SVG, and download links for the SVG and a PNG (they need no sign-in, so they can be handed to the writer).',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: QR_TARGETS, description: 'subscribe (the subscribe page), post or offer.' },
          id: { type: 'string', description: 'For post: the post\'s id (list_site_posts). For offer: the offer\'s id or code (list_site_offers).' },
          ...SITE_PARAM,
        },
        required: ['target'],
      },
      handler: async (params) => {
        const q = new URLSearchParams({ target: String(params.target ?? '') });
        if (typeof params.id === 'string' && params.id.trim()) q.set('id', params.id.trim());
        const res = await publishFetch(config, `/sites/qr?${q}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not make the QR code');
        const qr = (await res.json()) as { target: string; url: string; svg: string; download_url: string; png_download_url: string };
        return { target: qr.target, url: qr.url, svg: qr.svg, download_url: qr.download_url, png_download_url: qr.png_download_url };
      },
    },

    {
      name: 'list_perks',
      description:
        'The perks paid subscribers get besides the posts (a discount at a partner, a monthly call), oldest first. ' +
        'Paid readers see them on their account page and in their paid welcome email; free readers never do.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/perks', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load perks');
        const { perks } = (await res.json()) as { perks: ApiPerk[] };
        return { perks };
      },
    },

    {
      name: 'save_perk',
      description:
        'Add a perk for paid subscribers, or change one (with perk_id: only the fields given change). Up to 20 perks.',
      inputSchema: {
        type: 'object',
        properties: {
          ...PERK_ID,
          text: { type: 'string', description: 'What paid subscribers get, up to 300 characters, e.g. "20% off at the Riverside bookshop". Needed for a new perk.' },
          link: { type: 'string', description: 'Where to use it, an https address. An empty string removes it.' },
          code: { type: 'string', description: 'A code to use there, up to 100 characters. An empty string removes it.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, ['text', 'link', 'code']);
        const id = typeof params.perk_id === 'string' && params.perk_id.trim() ? params.perk_id : null;
        if (!id && typeof body.text !== 'string') return { error: 'Say what paid subscribers get (text).' };
        if (id && !Object.keys(body).length) return { error: 'Pass text, link or code to change.' };
        const res = await publishFetch(config, id ? `/sites/perks/${seg(id)}` : '/sites/perks', onSite(params.site, {
          method: id ? 'PATCH' : 'POST',
          body: JSON.stringify(body),
        }));
        if (!res.ok) return apiError(res, 'Could not save the perk');
        const { perk, message } = (await res.json()) as { perk: ApiPerk; message: string };
        return { success: true, perk, message };
      },
    },

    {
      name: 'delete_perk',
      description: 'Remove a perk. Paid subscribers stop seeing it at once; welcome emails already sent keep it.',
      inputSchema: { type: 'object', properties: { ...PERK_ID, ...SITE_PARAM }, required: ['perk_id'] },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/perks/${seg(params.perk_id)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not delete the perk');
        const { message } = (await res.json()) as { message: string };
        return { deleted: true, message };
      },
    },
  ];
}
