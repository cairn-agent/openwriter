import type { PluginMcpTool } from './helpers.js';
import { md, publishFetch } from './helpers.js';
import { memberId, WHO } from './site-member-support-tools.js';
import { apiError, onSite, pick, resolveSection, SITE_PARAM } from './site-tools.js';

/**
 * Money beyond plans: pause paid billing for the whole site (a break) or one subscriber,
 * pledges while paid plans are not open yet, and an offer's link sent by email. Sending tools
 * take dry_run to see the count first.
 */

const TIERS = ['free', 'paid', 'founding', 'comp'];

/** The API's answer as the tool's result: success with its fields, or its plain sentence. */
async function answer(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) return apiError(res, what);
  const data = (await res.json()) as Record<string, unknown>;
  return data.dry_run ? data : { success: true, ...data };
}

export function siteBillingTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'pause_billing',
      description:
        'Pause all paid billing for the site, for a vacation or a break. Only when the writer asks. Every paying subscription on the ' +
        'writer\'s Stripe stops being charged (Stripe voids each invoice, so nothing is owed later) and readers keep their paid access. ' +
        'New paid signups, gifts and group subscriptions are closed until billing resumes, and the subscribe page says so. With resume_at ' +
        'billing resumes by itself on that date; without it, until resume_billing. Run it again to change the date or retry failures.',
      inputSchema: {
        type: 'object',
        properties: {
          resume_at: { type: 'string', description: 'When billing resumes by itself, like 2026-11-03 (at most a year ahead). Leave out to resume by hand.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/billing/pause', onSite(params.site, {
          method: 'POST', body: JSON.stringify(pick(params, ['resume_at'])),
        }));
        return answer(res, 'Billing not paused');
      },
    },

    {
      name: 'resume_billing',
      description:
        'Resume paid billing paused with pause_billing, now. Each subscription is charged again from its next renewal, never for the ' +
        'paused time, and new paid signups open again. Subscribers paused one by one (pause_subscriber_billing) stay paused until their own date.',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/billing/resume', onSite(params.site, { method: 'POST', body: '{}' }));
        return answer(res, 'Billing not resumed');
      },
    },

    {
      name: 'pause_subscriber_billing',
      description:
        'Pause one paying subscriber\'s billing (they keep their access and are not charged; Stripe voids the invoices), or resume it with ' +
        'paused false. Only when the writer asks. Comps and group seats have no billing of their own and are refused.',
      inputSchema: {
        type: 'object',
        properties: {
          ...WHO,
          paused: { type: 'boolean', description: 'true to pause (the default), false to resume.' },
          resume_at: { type: 'string', description: 'With paused: when billing resumes by itself, like 2026-11-03. Leave out to resume by hand.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const who = await memberId(config, params);
        if ('error' in who) return who;
        const body = { paused: params.paused !== false, ...pick(params, ['resume_at']) };
        const res = await publishFetch(config, `/sites/members/${encodeURIComponent(who.id)}/pause`, onSite(params.site, {
          method: 'POST', body: JSON.stringify(body),
        }));
        return answer(res, body.paused ? 'Billing not paused' : 'Billing not resumed');
      },
    },

    {
      name: 'set_pledges',
      description:
        'Turn the pledge form on or off and set the prices it announces. While paid plans are not open (Stripe not connected, or no plans), ' +
        'readers can pledge monthly, annual or founding on the subscribe page: they subscribe for free and nothing is charged. Only the ' +
        'fields given change. Defaults: 5.00 a month, 50.00 a year, 150.00 founding. Amounts are in cents (500 is 5.00).',
      inputSchema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Show the pledge form.' },
          currency: { type: 'string', enum: ['usd', 'eur', 'gbp', 'cad', 'aud'], description: 'Currency of the prices. Cannot change once readers pledged.' },
          monthly: { type: 'number', description: 'Monthly pledge in cents, at least 500.' },
          annual: { type: 'number', description: 'Annual pledge in cents, at least 3000.' },
          founding: { type: ['number', 'null'], description: 'Founding pledge in cents, more than annual; null removes it.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/pledges/settings', onSite(params.site, {
          method: 'PUT', body: JSON.stringify(pick(params, ['enabled', 'currency', 'monthly', 'annual', 'founding'])),
        }));
        return answer(res, 'Pledges not saved');
      },
    },

    {
      name: 'list_pledges',
      description:
        'The pledges: how many, how many confirmed their email, how many now pay, by plan, and what the confirmed pledges would bring ' +
        'in a month (monthly_revenue, in cents; annual and founding count as a twelfth). Each pledge has the reader, plan, amount, ' +
        'their subscriber status and when they were emailed the link. can_email says whether email_pledgers would reach anyone now.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many pledges to list, up to 500 (default 100).' },
          offset: { type: 'number', description: 'Skip this many, for the next page.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const q = new URLSearchParams();
        q.set('limit', String(Math.min(500, Math.max(1, Number(params.limit) || 100))));
        if (params.offset) q.set('offset', String(Math.max(0, Number(params.offset) || 0)));
        const res = await publishFetch(config, `/sites/pledges?${q}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not list pledges');
        return res.json();
      },
    },

    {
      name: 'email_pledgers',
      description:
        'Once paid plans are open, email the readers who pledged a link to subscribe. Each pledger gets it once; run it again later ' +
        'only for new pledgers. Subject and message are optional (a thank-you is used); the link is added. Run with dry_run first: ' +
        'it returns how many would get it and sends nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: 'The subject line. Default: "Paid subscriptions to <site> are open".' },
          body: { type: 'string', description: 'Your message, in markdown or HTML. The link to subscribe is added below it.' },
          dry_run: { type: 'boolean', description: 'Count who would get it and send nothing.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const payload: Record<string, unknown> = pick(params, ['subject', 'dry_run']);
        if (typeof params.body === 'string' && params.body.trim()) payload.body_html = md.render(params.body);
        const res = await publishFetch(config, '/sites/pledges/email', onSite(params.site, { method: 'POST', body: JSON.stringify(payload) }));
        return answer(res, 'Not sent');
      },
    },

    {
      name: 'email_offer',
      description:
        'Email an offer\'s link (from list_offers) with the writer\'s message to a group of subscribers: free subscribers unless tier ' +
        'says otherwise, narrowed by section and search. The offer\'s terms and a "Claim this offer" link are added below the message. ' +
        'Only a live offer can be sent. Run with dry_run first: it returns how many would get it and sends nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          offer_id: { type: 'string', description: 'The offer, from list_offers.' },
          subject: { type: 'string', description: 'The subject line.' },
          body: { type: 'string', description: 'Your message, in markdown or HTML.' },
          tier: { type: 'string', enum: TIERS, description: 'Who gets it: free (the default), paid, founding or comp subscribers.' },
          section: { type: 'string', description: 'Only subscribers who get this section, by name, slug or id.' },
          search: { type: 'string', description: 'Only subscribers whose email or name contains this.' },
          dry_run: { type: 'boolean', description: 'Count who would get it and send nothing.' },
          ...SITE_PARAM,
        },
        required: ['offer_id', 'subject', 'body'],
      },
      handler: async (params) => {
        if (typeof params.body !== 'string' || !params.body.trim()) return { error: 'The message needs a body.' };
        const payload: Record<string, unknown> = { ...pick(params, ['subject', 'tier', 'search', 'dry_run']), body_html: md.render(params.body) };
        if (typeof params.section === 'string' && params.section.trim()) {
          const id = await resolveSection(config, params.site, params.section);
          if (id && typeof id === 'object') return id;
          if (id) payload.section_id = id;
        }
        const res = await publishFetch(config, `/sites/offers/${encodeURIComponent(String(params.offer_id))}/email`, onSite(params.site, {
          method: 'POST', body: JSON.stringify(payload),
        }));
        return answer(res, 'Not sent');
      },
    },
  ];
}
