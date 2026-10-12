import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';

/** An old tool name kept working: the same handler, pointing at the new name. */
function deprecatedAlias(tool: PluginMcpTool, oldName: string): PluginMcpTool {
  return {
    ...tool,
    name: oldName,
    description: `DEPRECATED — renamed to ${tool.name}. Use ${tool.name} instead. This alias may be removed in a future release.`,
  };
}

/**
 * The sending domain: the writer's own domain that site emails come from (newsletter@example.com),
 * set up through SendGrid. Not the site's web address, which is set_site_domain. Who emails come
 * from and where replies go are shown together by get_site (sender); the reply-to address is an
 * update_site_settings field.
 */
export function siteSenderTools(config: Record<string, string>): PluginMcpTool[] {
  const setSendingDomain: PluginMcpTool = {
    name: 'set_sending_domain',
    description:
      'Send the site\'s emails from the writer\'s own domain (e.g. newsletter@example.com) instead of <name>@mail.openwriter.io. ' +
      'This is the email sending domain, not the website address (that is set_site_domain). ' +
      'Handles SendGrid domain authentication, the DNS records (added automatically for Cloudflare domains) and sender verification. ' +
      'Follow the next_action field in the response, then check_sending_domain until fully_ready.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'Domain to send from (e.g. "example.com").' },
        from_email: { type: 'string', description: 'From address (e.g. "newsletter@example.com").' },
        from_name: { type: 'string', description: 'From display name (e.g. "Example Weekly"). Defaults to the site name.' },
        physical_address: {
          type: 'string',
          description: 'Physical mailing address for CAN-SPAM compliance (required before sending). E.g. "123 Main St, Portland, OR 97201"',
        },
      },
      required: ['domain', 'from_email'],
    },
    handler: async (params) => {
      const res = await publishFetch(config, '/newsletter/domains', {
        method: 'POST',
        body: JSON.stringify({
          domain: params.domain,
          from_email: params.from_email,
          from_name: params.from_name || undefined,
          physical_address: params.physical_address || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { error: `Failed to setup domain: ${(err as any).error || res.statusText}` };
      }

      const data = await res.json() as {
        domain: any;
        dnsRecords: any[];
        cloudflare_managed: boolean;
        dns_auto_added: boolean;
        sender_verification_sent: boolean;
        next_action: string;
      };
      return {
        success: true,
        domainId: data.domain.id,
        domain: data.domain.domain,
        dnsRecords: data.dnsRecords,
        cloudflare_managed: data.cloudflare_managed,
        dns_auto_added: data.dns_auto_added,
        sender_verification_sent: data.sender_verification_sent,
        next_action: data.next_action,
      };
    },
  };

  const checkSendingDomain: PluginMcpTool = {
    name: 'check_sending_domain',
    description:
      'Check whether an email sending domain is fully ready (DNS verified and sender verified). If domain_id is left out, lists every sending domain with its status. ' +
      'For the website address use check_site_domain.',
    inputSchema: {
      type: 'object',
      properties: {
        domain_id: {
          type: 'string',
          description: 'Sending domain id (from set_sending_domain). Leave out to list all sending domains.',
        },
      },
    },
    handler: async (params) => {
      if (!params.domain_id) {
        const res = await publishFetch(config, '/newsletter/domains');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: `Failed to list domains: ${(err as any).error || res.statusText}` };
        }
        const data = await res.json() as { domains: any[] };
        return {
          domains: data.domains.map((d: any) => ({
            id: d.id,
            domain: d.domain,
            fromEmail: d.from_email,
            status: d.status,
            senderStatus: d.sender_status,
            cloudflareManaged: d.cloudflare_managed,
            hasPhysicalAddress: !!d.physical_address,
          })),
        };
      }

      const res = await publishFetch(config, `/newsletter/domains/${params.domain_id}/verify`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { error: `Status check failed: ${(err as any).error || res.statusText}` };
      }

      const data = await res.json() as {
        domain: string;
        dns_verified: boolean;
        sender_verified: boolean;
        fully_ready: boolean;
        next_action: string;
      };
      return {
        domain: data.domain,
        dns_verified: data.dns_verified,
        sender_verified: data.sender_verified,
        fully_ready: data.fully_ready,
        next_action: data.next_action,
      };
    },
  };

  const resendVerification: PluginMcpTool = {
    name: 'resend_sending_domain_verification',
    description:
      'Resend the sender verification email for an email sending domain. Use when the writer did not receive or cannot find the original verification email.',
    inputSchema: {
      type: 'object',
      properties: {
        domain_id: { type: 'string', description: 'Sending domain id to resend verification for.' },
      },
      required: ['domain_id'],
    },
    handler: async (params) => {
      const res = await publishFetch(config, `/newsletter/domains/${params.domain_id}/resend-verification`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { error: `Resend failed: ${(err as any).error || res.statusText}` };
      }

      const data = await res.json() as { success: boolean; message: string };
      return {
        success: true,
        message: data.message,
      };
    },
  };

  return [
    setSendingDomain,
    checkSendingDomain,
    resendVerification,
    deprecatedAlias(setSendingDomain, 'setup_custom_domain'),
    deprecatedAlias(checkSendingDomain, 'check_domain_status'),
    deprecatedAlias(resendVerification, 'resend_domain_verification'),
  ];
}
