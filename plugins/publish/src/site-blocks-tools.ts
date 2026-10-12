import { existsSync, readFileSync, statSync } from 'fs';
import { basename, isAbsolute, join } from 'path';
import type { PluginMcpTool } from './helpers.js';
import { getServerModules, publishFetch } from './helpers.js';
import { apiError, onSite, SITE_PARAM } from './site-tools.js';

/** Doc metadata key holding the post this doc was published as (site-tools.ts). */
const POST_KEY = 'sitePost';
const MAX_FILE_MB = 20;

/** Post blocks that need more than typing a line: a poll's results, and a file to attach. */
export function siteBlocksTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'get_poll_results',
      description:
        'Results of the polls in a site post: each poll\'s question, total votes, and each choice\'s votes and percent. ' +
        'A poll is a line "[poll] Question" followed by a bulleted list of 2 to 6 choices in the post; readers vote once, on the post page or from the email. ' +
        'Leave out post_id for the active document\'s post. Voters are never named.',
      inputSchema: {
        type: 'object',
        properties: {
          post_id: { type: 'string', description: 'A post\'s id or slug (list_site_posts). Leave out for the active document\'s post.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const asked = typeof params.post_id === 'string' && params.post_id.trim() ? params.post_id.trim() : null;
        let id = asked;
        let site = params.site;
        if (!id) {
          const docPost = (await getServerModules()).getMetadata()?.[POST_KEY];
          if (!docPost?.id) return { error: 'This document has not been published to the site. Pass post_id for another post.' };
          id = docPost.id as string;
          site ??= docPost.site;
        }
        const res = await publishFetch(config, `/sites/posts/${encodeURIComponent(id)}/polls`, onSite(site));
        if (res.status === 404) return { error: asked ? `No post "${asked}" on this site.` : 'The post this document was published as no longer exists.' };
        if (!res.ok) return apiError(res, 'Could not load the poll results');
        const { post, polls } = (await res.json()) as { post: { id: string; title: string; slug: string; status: string }; polls: unknown[] };
        return {
          post_id: post.id, title: post.title, slug: post.slug, status: post.status, polls,
          ...(polls.length ? {} : { note: 'This post has no polls. Add a line "[poll] Your question" followed by a bulleted list of 2 to 6 choices, then publish again.' }),
        };
      },
    },

    {
      name: 'attach_file_to_post',
      description:
        `Upload a file (PDF, EPUB, ZIP, CSV, TXT, DOCX, XLSX or PPTX, up to ${MAX_FILE_MB} MB) so a post can offer it as a download. ` +
        'Returns a markdown link: put it on a line of its own in the document where the download should appear, then publish. ' +
        'Readers who can see that part of the post get a download card (a link in emails and RSS); inside a [paid-only] part, only paid readers get it. ' +
        'The file counts against the site\'s storage, like pictures.',
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file on this computer: a full path, or a path inside the OpenWriter data folder.' },
          content_base64: { type: 'string', description: 'The file\'s bytes as base64, instead of path (a file picked in a browser). Needs name.' },
          name: { type: 'string', description: 'The name readers see and download it as, with its extension. Defaults to the file\'s own name.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const given = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : '';
        let data: string;
        let name: string;
        if (typeof params.content_base64 === 'string' && params.content_base64) {
          if (!given) return { error: 'Pass name (with its extension) along with content_base64.' };
          if (Buffer.byteLength(params.content_base64, 'base64') > MAX_FILE_MB * 1024 * 1024) return { error: `The file is larger than ${MAX_FILE_MB} MB.` };
          data = params.content_base64;
          name = given;
        } else {
          const raw = typeof params.path === 'string' ? params.path.trim() : '';
          if (!raw) return { error: 'Pass the path of the file to attach, or its content_base64 and name.' };
          const file = isAbsolute(raw) && existsSync(raw) ? raw : join((await getServerModules()).getDataDir(), raw);
          if (!existsSync(file) || !statSync(file).isFile()) return { error: `There is no file at ${raw}.` };
          if (statSync(file).size > MAX_FILE_MB * 1024 * 1024) return { error: `The file is larger than ${MAX_FILE_MB} MB.` };
          data = readFileSync(file).toString('base64');
          name = given || basename(file);
        }
        const res = await publishFetch(config, '/sites/files', onSite(params.site, {
          method: 'POST',
          body: JSON.stringify({ name, data }),
        }));
        if (!res.ok) return apiError(res, 'Could not attach the file');
        const { file: stored, markdown } = (await res.json()) as {
          file: { name: string; url: string; size_bytes: number; content_type: string };
          markdown: string;
        };
        return {
          success: true,
          name: stored.name,
          url: stored.url,
          size_bytes: stored.size_bytes,
          content_type: stored.content_type,
          markdown,
          note: 'Put the markdown line on its own line in the post where the download should appear, then publish.',
        };
      },
    },
  ];
}
