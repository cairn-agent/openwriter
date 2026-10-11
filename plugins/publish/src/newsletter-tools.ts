import type { PluginMcpTool } from './helpers.js';
import {
  getServerModules,
  documentToEmail,
  extractLocalImages,
  publishFetch,
} from './helpers.js';

export function newsletterTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'send_newsletter',
      description:
        'Send the current document as an old-style newsletter, to the old newsletter list only, or to a single test address if test_email is provided. Supports subscriber selection via subscriber_ids or exclude_issue_id. Subscribers added, imported or signed up since the list moved to the site are not on that list: to reach the site\'s subscribers, publish the document as a site post with publish_to_site.',
      inputSchema: {
        type: 'object',
        properties: {
          subject: {
            type: 'string',
            description: 'Email subject line. Defaults to the document title if not provided.',
          },
          format: {
            type: 'string',
            enum: ['html', 'plaintext'],
            description: 'Email format: "html" (rich formatted) or "plaintext" (plain text only). Defaults to "html".',
          },
          test_email: {
            type: 'string',
            description: 'If provided, sends a test email to this address instead of all subscribers.',
          },
          subscriber_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Send only to these subscriber IDs on the old newsletter list (from get_newsletter_analytics recipients).',
          },
          exclude_issue_id: {
            type: 'string',
            description: 'Send to subscribers who did NOT receive this issue (use list_newsletter_issues to find issue IDs). For "send to remaining" after a partial send.',
          },
        },
      },
      handler: async (params) => {
        const { html, text, subject: docTitle, json } = await documentToEmail();
        const subject = (params.subject as string) || docTitle;
        const format = (params.format as string) || 'html';
        const testEmail = params.test_email as string | undefined;
        let subscriberIds = params.subscriber_ids as string[] | string | undefined;
        if (typeof subscriberIds === 'string') {
          try { subscriberIds = JSON.parse(subscriberIds); } catch { subscriberIds = undefined; }
        }
        const excludeIssueId = params.exclude_issue_id as string | undefined;

        const server = await getServerModules();
        const metadata = server.getMetadata();
        const previewText = metadata?.newsletterContext?.previewText || undefined;

        if (!text.trim() && !html.trim()) {
          return { error: 'Newsletter body is empty. Write some content in the editor before sending.' };
        }

        const images = format === 'html' && html ? await extractLocalImages(html) : [];
        const docId = server.getDocId();

        const res = await publishFetch(config, '/newsletter/issues/send', {
          method: 'POST',
          body: JSON.stringify({
            subject,
            content_html: format === 'html' ? html : null,
            content_text: text,
            content_json: json,
            format,
            test_email: testEmail,
            preview_text: previewText,
            images,
            document_id: docId || undefined,
            subscriber_ids: subscriberIds,
            exclude_issue_id: excludeIssueId,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: `Send failed: ${(err as any).error || res.statusText}` };
        }

        const data = await res.json() as { sent?: number; failed?: number; test?: boolean; sent_to?: string; issueId?: string };

        if (data.test) {
          return {
            success: true,
            test: true,
            sent_to: data.sent_to,
            message: `Test email sent to ${data.sent_to}.`,
          };
        }

        return {
          success: true,
          sent: data.sent,
          failed: data.failed,
          issueId: data.issueId,
          message: `Newsletter sent to ${data.sent} subscribers.${data.failed && data.failed > 0 ? ` ${data.failed} failed.` : ''}`,
        };
      },
    },

    {
      name: 'resend_to_unopened',
      description:
        'Resend a newsletter issue to subscribers who didn\'t open it. Uses a new subject line but the same email body. Can only be done once per issue. Best practice: wait 48-72 hours after original send.',
      inputSchema: {
        type: 'object',
        properties: {
          issue_id: { type: 'string', description: 'Newsletter issue ID to resend (from list_newsletter_issues)' },
          subject: { type: 'string', description: 'New subject line for the resend (tip: try a different angle)' },
        },
        required: ['issue_id', 'subject'],
      },
      handler: async (params) => {
        const issueId = params.issue_id as string;
        const subject = params.subject as string;

        const res = await publishFetch(config, `/newsletter/issues/${issueId}/resend`, {
          method: 'POST',
          body: JSON.stringify({ subject }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: `Resend failed: ${(err as any).error || res.statusText}` };
        }

        const data = await res.json() as { sent: number; failed: number; non_openers: number };
        return {
          success: true,
          sent: data.sent,
          failed: data.failed,
          non_openers: data.non_openers,
          message: `Resent to ${data.sent} non-openers with new subject: "${subject}".${data.failed > 0 ? ` ${data.failed} failed.` : ''}`,
        };
      },
    },

    {
      name: 'list_newsletter_issues',
      description: 'List past newsletter sends with open/click stats. Returns issue IDs needed for get_newsletter_analytics and send_newsletter exclude_issue_id.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max issues to return (default 20, max 200)' },
        },
      },
      handler: async (params) => {
        const limit = Math.min((params.limit as number) || 20, 200);
        const res = await publishFetch(config, `/newsletter/issues?limit=${limit}`);

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: `Failed to list issues: ${(err as any).error || res.statusText}` };
        }

        const data = await res.json() as { issues: any[] };
        return {
          issues: data.issues.map((i: any) => ({
            id: i.id,
            subject: i.subject,
            status: i.status,
            sent_at: i.sent_at,
            recipient_count: i.recipient_count,
            unique_opens: i.unique_opens,
            unique_clicks: i.unique_clicks,
          })),
        };
      },
    },

    {
      name: 'get_newsletter_analytics',
      description: 'Get detailed analytics for a specific newsletter issue. Shows delivery stats, per-subscriber event breakdown, and recipient list.',
      inputSchema: {
        type: 'object',
        properties: {
          issue_id: { type: 'string', description: 'Newsletter issue ID (from list_newsletter_issues)' },
        },
        required: ['issue_id'],
      },
      handler: async (params) => {
        const issueId = params.issue_id as string;
        const res = await publishFetch(config, `/newsletter/issues/${issueId}/analytics`);

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          return { error: `Failed to get analytics: ${(err as any).error || res.statusText}` };
        }

        return await res.json();
      },
    },
  ];
}
