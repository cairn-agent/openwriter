import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';

// Email goes out only as site posts (publish_to_site with send_email); these tools read past sends.
export function newsletterTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'list_newsletter_issues',
      description: 'List past newsletter sends with open/click stats. Returns issue IDs needed for get_newsletter_analytics.',
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
