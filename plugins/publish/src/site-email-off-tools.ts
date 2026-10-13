import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { memberId, WHO } from './site-member-support-tools.js';
import { apiError, onSite, SITE_PARAM } from './site-tools.js';

/**
 * A subscriber's email switch (PATCH /sites/members/:id): with emails off they stay subscribed,
 * keep everything their subscription gives them (paid posts, comments, the archive) and get no
 * posts or messages by email. Owners and admins only; a contributor gets a refusal from the API.
 */

export function siteEmailOffTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'set_subscriber_emails',
      description:
        'Turn a subscriber\'s emails off or back on. With emails off they stay subscribed and keep all their access, paid ' +
        'access and billing included; they just get no posts, messages or digests by email (sign-in codes, receipts and ' +
        'billing notices still go). Readers can also do this themselves on their account page or from an email\'s ' +
        'Unsubscribe link. Only active subscribers have the switch.',
      inputSchema: {
        type: 'object',
        properties: {
          ...WHO,
          email_off: { type: 'boolean', description: 'true: no more emails, still subscribed. false: emails back on.' },
          ...SITE_PARAM,
        },
        required: ['email_off'],
      },
      handler: async (params) => {
        if (typeof params.email_off !== 'boolean') return { error: 'email_off must be true or false.' };
        const who = await memberId(config, params);
        if ('error' in who) return who;
        const res = await publishFetch(config, `/sites/members/${encodeURIComponent(who.id)}`, onSite(params.site, {
          method: 'PATCH',
          body: JSON.stringify({ email_off: params.email_off }),
        }));
        if (!res.ok) return apiError(res, 'Emails not changed');
        return { success: true, ...((await res.json()) as object) };
      },
    },
  ];
}
