import { mkdirSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, SITE_PARAM } from './site-tools.js';

/**
 * Account controls for a site: export everything as a zip, delete the publication, and
 * hand it to an admin (POST /sites/export, /sites/delete, /sites/transfer). Delete and
 * transfer are the owner's alone and cannot be undone by the writer.
 */

/** The API's refusal as a plain sentence, keeping any counts it gave. */
async function refusal(res: Response, what: string): Promise<Record<string, unknown>> {
  const body = (await res.clone().json().catch(() => null)) as Record<string, unknown> | null;
  if (!body?.message) return apiError(res, what);
  const { error: _code, message, ...rest } = body;
  return { error: `${what}: ${message}`, ...rest };
}

/** Where to write the zip: the path itself, or the export's own file name inside it when it is a folder. */
function target(path: string, filename: string): string {
  try {
    if (statSync(path).isDirectory()) return join(path, filename);
  } catch { /* not there yet: a file path */ }
  return /[\\/]$/.test(path) ? join(path, filename) : path;
}

export function siteAccountTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'export_site',
      description:
        'Export everything on the site as one zip: every post (drafts too) as Markdown with its settings at the top and as HTML, ' +
        'the subscriber list as CSV (free and paid, with plans), comments, settings, sections, tags and plans. Owners and admins. ' +
        'Without save_to it returns a download link that works for 15 minutes in any browser; with save_to it saves the zip on ' +
        'this computer.',
      inputSchema: {
        type: 'object',
        properties: {
          save_to: { type: 'string', description: 'A folder or file path on this computer to save the zip to. Leave out to get a download link.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/export', onSite(params.site, { method: 'POST' }));
        if (!res.ok) return apiError(res, 'Could not export the site');
        const link = (await res.json()) as { url: string; filename: string; expires_at: string; message: string };
        const saveTo = typeof params.save_to === 'string' ? params.save_to.trim() : '';
        if (!saveTo) return { success: true, ...link };
        const download = await fetch(link.url);
        if (!download.ok) return { error: `The export did not download (${download.status}). Try again.` };
        const data = Buffer.from(await download.arrayBuffer());
        const file = target(saveTo, link.filename);
        try {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, data);
        } catch (err: any) {
          return { error: `Could not save the export to ${file}: ${err?.message ?? err}` };
        }
        return { success: true, saved_to: file, bytes: data.length, filename: link.filename, message: `Saved the export to ${file}.` };
      },
    },

    {
      name: 'delete_site',
      description:
        'Delete the publication for good: its posts, subscribers, comments, settings and plans, and its address becomes free for ' +
        'anyone. OWNER ONLY and CANNOT BE UNDONE: only when the writer asked, after offering export_site. confirm_name is the ' +
        'site\'s name as the writer typed it to confirm. Refused while any reader still pays: the answer gives the count; cancel ' +
        'them first with cancel_subscription (when "now"), refunding as the writer decides. OpenWriter disconnects from the ' +
        'writer\'s Stripe and removes the custom domain.',
      inputSchema: {
        type: 'object',
        properties: {
          confirm_name: { type: 'string', description: 'The site\'s name, typed by the writer to confirm.' },
          ...SITE_PARAM,
        },
        required: ['confirm_name'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/delete', onSite(params.site, {
          method: 'POST',
          body: JSON.stringify({ confirm_name: params.confirm_name }),
        }));
        if (!res.ok) return refusal(res, 'Site not deleted');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'transfer_site_ownership',
      description:
        'Make an admin on the team the owner of the site. OWNER ONLY and the writer cannot take it back: only when the writer ' +
        'asked, with confirm: true. The writer stays on as an admin. The new owner gets the site on their account\'s main ' +
        'profile; payments keep going to the Stripe account connected to the site until the new owner connects their own. ' +
        'Only someone who accepted an admin invite can become owner (list_site_team).',
      inputSchema: {
        type: 'object',
        properties: {
          member_id: { type: 'string', description: 'The admin\'s team member id, from list_site_team.' },
          email: { type: 'string', description: 'The admin\'s email, instead of member_id.' },
          confirm: { type: 'boolean', description: 'true once the writer has agreed to give the site away.' },
          ...SITE_PARAM,
        },
        required: ['confirm'],
      },
      handler: async (params) => {
        if (params.confirm !== true) return { error: 'Giving the site to someone else cannot be undone by you. Pass confirm: true once the writer has agreed.' };
        let memberId = typeof params.member_id === 'string' ? params.member_id.trim() : '';
        if (!memberId) {
          const email = typeof params.email === 'string' ? params.email.trim().toLowerCase() : '';
          if (!email) return { error: 'Give member_id (from list_site_team) or the admin\'s email.' };
          const res = await publishFetch(config, '/sites/team', onSite(params.site));
          if (!res.ok) return apiError(res, 'Could not load the team');
          const { members } = (await res.json()) as { members: { id: string; invited_email: string }[] };
          const found = members.find((m) => m.invited_email.toLowerCase() === email);
          if (!found) return { error: `Nobody with the email ${email} is on the team.` };
          memberId = found.id;
        }
        const res = await publishFetch(config, '/sites/transfer', onSite(params.site, {
          method: 'POST',
          body: JSON.stringify({ member_id: memberId }),
        }));
        if (!res.ok) return refusal(res, 'Site not transferred');
        return { success: true, ...((await res.json()) as object) };
      },
    },
  ];
}
