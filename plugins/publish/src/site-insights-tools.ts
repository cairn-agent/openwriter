import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, SITE_PARAM } from './site-tools.js';

/**
 * The site's Stats pages: subscribers over time, paid retention by month, and where post
 * views come from (GET /sites/stats/growth, /retention, /traffic). Owners and admins only;
 * a contributor gets a refusal from the API. Each tool returns the API's answer as it is.
 */

const RANGE = {
  from: { type: 'string', description: 'First day, like 2026-09-01 (UTC).' },
  to: { type: 'string', description: 'Last day, like 2026-09-30 (UTC). Default today.' },
};

/** GET path with the given query parameters (left-out ones skipped), as the API's answer or an error. */
async function getStats(config: Record<string, string>, params: Record<string, unknown>, path: string, keys: string[], failed: string) {
  const q = new URLSearchParams();
  for (const k of keys) {
    const v = params[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') q.set(k === 'post_id' ? 'post' : k, String(v).trim());
  }
  const query = q.toString();
  const res = await publishFetch(config, `${path}${query ? `?${query}` : ''}`, onSite(params.site));
  if (!res.ok) return apiError(res, failed);
  return (await res.json()) as object;
}

export function siteInsightsTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'get_subscriber_growth',
      description:
        'Subscribers over time: for each day (or week, starting Monday) the active subscribers at its end, as free, paid ' +
        '(paid and founding), comp and total. Default the last 30 days, or 12 weeks by week; at most 731 days. ' +
        'exact_from and note say when the site\'s history begins to be exact: before it, people who later left are not counted.',
      inputSchema: {
        type: 'object',
        properties: {
          interval: { type: 'string', enum: ['day', 'week'], description: 'day (default) or week.' },
          ...RANGE,
          ...SITE_PARAM,
        },
      },
      handler: (params) => getStats(config, params, '/sites/stats/growth', ['interval', 'from', 'to'], 'Could not load subscriber growth'),
    },

    {
      name: 'get_paid_retention',
      description:
        'Paid subscribers month by month, this month last: paying at the start, new paid (a trial counts when it converts), ' +
        'cancelled, paying at the end, churn_rate (cancelled as a percent of those paying at the start) and mrr at the ' +
        'month\'s end (payers at today\'s plan prices). Paying means a reader\'s own subscription, so comps, gifts and group ' +
        'seats are not counted; mrr_now and paying_now are today\'s figures, mrr_now including groups. Amounts in cents of currency.',
      inputSchema: {
        type: 'object',
        properties: {
          months: { type: 'number', description: 'How many months, 1 to 36 (default 12).' },
          ...SITE_PARAM,
        },
      },
      handler: (params) => getStats(config, params, '/sites/stats/retention', ['months'], 'Could not load paid retention'),
    },

    {
      name: 'get_traffic_sources',
      description:
        'Where post views came from, for the whole site or one post: channels (direct, your site, search engines, social media, ' +
        'webmail, other websites, links with utm_source) with views and share, and the top websites and utm_sources. ' +
        'Default the last 30 days. untracked_views are views counted before sources were recorded. Only the referring ' +
        'website and utm_source are kept, never anything about the reader.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'Only this post (its id or slug, from list_site_posts).' },
          ...RANGE,
          ...SITE_PARAM,
        },
      },
      handler: (params) => getStats(config, params, '/sites/stats/traffic', ['from', 'to', 'post_id'], 'Could not load traffic sources'),
    },
  ];
}
