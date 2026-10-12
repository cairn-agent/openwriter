import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, SITE_PARAM } from './site-tools.js';

/**
 * Paid-subscriber support: one subscriber's details, and refund, cancel, auto-renew and
 * founding for a paying reader on the writer's own Stripe (POST /sites/members/:id/...).
 * Tools that move money or end a subscription start with refund_ or cancel_, which the
 * web app's chat asks the writer to confirm.
 */

export const WHO = {
  member_id: { type: 'string', description: 'The subscriber id (from list_subscribers or get_subscriber).' },
  email: { type: 'string', description: 'The subscriber\'s email, instead of member_id.' },
};

/** The member id from member_id, or found by exact email among the site's members. */
export async function memberId(config: Record<string, string>, params: Record<string, unknown>): Promise<{ id: string } | { error: string }> {
  if (typeof params.member_id === 'string' && params.member_id.trim()) return { id: params.member_id.trim() };
  const email = typeof params.email === 'string' ? params.email.trim().toLowerCase() : '';
  if (!email) return { error: 'Give member_id (from list_subscribers) or email.' };
  const res = await publishFetch(config, `/sites/members?search=${encodeURIComponent(email)}&limit=500`, onSite(params.site));
  if (!res.ok) return apiError(res, 'Could not look up the subscriber');
  const { members } = (await res.json()) as { members: { id: string; email: string }[] };
  const found = members.find((m) => m.email.toLowerCase() === email);
  return found ? { id: found.id } : { error: `No subscriber with the email ${email} on this site.` };
}

/** POST one support action for a member; the API's message says exactly what was done. */
async function act(config: Record<string, string>, params: Record<string, unknown>, action: string, body: object, failed: string) {
  const who = await memberId(config, params);
  if ('error' in who) return who;
  const res = await publishFetch(config, `/sites/members/${encodeURIComponent(who.id)}/${action}`, onSite(params.site, {
    method: 'POST',
    body: JSON.stringify(body),
  }));
  if (!res.ok) return apiError(res, failed);
  return { success: true, ...((await res.json()) as object) };
}

export function siteMemberSupportTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'get_subscriber',
      description:
        'One subscriber in detail: tier, status, source, when they joined, their tags, the country they are billed in ' +
        '(billing_country and billing_country_name, for paying readers), founding, comp; their paid plan as Stripe has it ' +
        '(amount in cents, interval, renewal date, whether it renews, trial end); their last 24 payments with refunds and invoice ' +
        'links; their activity (site emails received, emails opened and clicked, comments, likes, last seen); and the support ' +
        'actions taken on them. Post views per reader are not recorded.',
      inputSchema: { type: 'object', properties: { ...WHO, ...SITE_PARAM } },
      handler: async (params) => {
        const who = await memberId(config, params);
        if ('error' in who) return who;
        const res = await publishFetch(config, `/sites/members/${encodeURIComponent(who.id)}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the subscriber');
        return res.json();
      },
    },

    {
      name: 'refund_subscriber',
      description:
        'Refund a paying subscriber on the writer\'s Stripe. MOVES MONEY: only when the writer asked for this refund. ' +
        'Without payment_id it refunds their latest payment; without amount_cents, all that is left of it. It never refunds ' +
        'an older payment on its own. OpenWriter\'s 5% fee on the refunded part is returned too. The subscription is not ' +
        'cancelled; use cancel_subscription for that. Payment ids are in get_subscriber.',
      inputSchema: {
        type: 'object',
        properties: {
          ...WHO,
          payment_id: { type: 'string', description: 'The payment to refund (ch_..., from get_subscriber payments). Default: the latest.' },
          amount_cents: { type: 'number', description: 'How much to refund, in cents (800 is 8.00). Default: all that is left of the payment.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => act(config, params, 'refund', {
        ...(params.payment_id !== undefined ? { payment: params.payment_id } : {}),
        ...(params.amount_cents !== undefined ? { amount: params.amount_cents } : {}),
      }, 'Refund not made'),
    },

    {
      name: 'cancel_subscription',
      description:
        'Cancel a subscriber\'s paid subscription on the writer\'s Stripe. Only when the writer asked. when "now" ends paid ' +
        'access at once (no refund; use refund_subscriber for that); "period_end" lets it run to the end of what they paid for ' +
        'and stops renewal. Comps and group seats are not subscriptions of their own and are refused.',
      inputSchema: {
        type: 'object',
        properties: {
          ...WHO,
          when: { type: 'string', enum: ['now', 'period_end'], description: 'now, or at the end of the current period.' },
          ...SITE_PARAM,
        },
        required: ['when'],
      },
      handler: async (params) => act(config, params, 'cancel', { when: params.when }, 'Subscription not cancelled'),
    },

    {
      name: 'set_auto_renew',
      description:
        'Turn a paid subscription\'s auto-renew off (it ends at the end of the period they paid for; they keep access until ' +
        'then) or back on. Changes the subscription on the writer\'s Stripe; nothing is charged now.',
      inputSchema: {
        type: 'object',
        properties: { ...WHO, auto_renew: { type: 'boolean', description: 'false: end at period end. true: keep renewing.' }, ...SITE_PARAM },
        required: ['auto_renew'],
      },
      handler: async (params) => act(config, params, 'renewal', { auto_renew: params.auto_renew }, 'Auto-renew not changed'),
    },

    {
      name: 'set_founding',
      description:
        'Mark a paying subscriber as a founding member (founding-only posts and the founding welcome email) without changing ' +
        'what they pay, or remove the mark. It lasts while their current subscription pays. For a comped reader, grant the ' +
        'comp again with founding instead.',
      inputSchema: {
        type: 'object',
        properties: { ...WHO, founding: { type: 'boolean', description: 'true to mark founding, false to remove the mark.' }, ...SITE_PARAM },
        required: ['founding'],
      },
      handler: async (params) => act(config, params, 'founding', { founding: params.founding }, 'Founding not changed'),
    },
  ];
}
