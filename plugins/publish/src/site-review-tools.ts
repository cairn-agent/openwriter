import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, SITE_PARAM } from './site-tools.js';

/** The sending-limit review: new sites email a limited number of people a day until OpenWriter approves them. */
export function siteReviewTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'request_site_review',
      description:
        'Ask OpenWriter to review the site and lift its sending limit. New sites can email a limited number of people a day ' +
        '(get_site shows sending.status "review" and sending.daily_cap) until they are approved; the writer is emailed when that happens. ' +
        'The site needs a name first, and a request can be made once a day. Owners and admins only.',
      inputSchema: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'Optional, up to 1000 characters: anything that helps the review, such as where the subscribers came from.',
          },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const note = typeof params.note === 'string' && params.note.trim() ? { note: params.note } : {};
        const res = await publishFetch(config, '/sites/review', onSite(params.site, { method: 'POST', body: JSON.stringify(note) }));
        if (!res.ok) return apiError(res, 'Could not ask for review');
        const { sending, message } = (await res.json()) as {
          sending: { status: string; daily_send_cap: number; review_requested_at: string };
          message: string;
        };
        return {
          success: true,
          status: sending.status,
          daily_send_cap: sending.daily_send_cap,
          review_requested_at: sending.review_requested_at,
          message,
        };
      },
    },
  ];
}
