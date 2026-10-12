import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import {
  parseFeed, parseGhostExport, parseMediumExport, parseWordpressApi, parseWordpressExport, unzipMediumPosts,
  type ImportPost, type Parsed,
} from './site-import-parse.js';
import { apiError, onSite, SITE_PARAM } from './site-tools.js';

/**
 * Bring a writer's back catalogue over from WordPress, Ghost, Medium or any RSS/Atom feed. The
 * file or feed is read here, on the writer's side, and the posts go to the site API in batches
 * (POST /sites/import/posts), which stores them with their original dates, copies their pictures
 * into the site's storage and skips posts imported before. Nothing is ever emailed.
 */

const SOURCES = ['wordpress', 'ghost', 'medium', 'rss'] as const;
type Source = (typeof SOURCES)[number];
/** The API takes at most this many posts per request; fewer when they carry many pictures. */
const BATCH_POSTS = 10;
const BATCH_IMAGES = 40;
const BATCH_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const NAMES: Record<Source, string> = { wordpress: 'WordPress', ghost: 'Ghost', medium: 'Medium', rss: 'the feed' };

/** The posts as the API's field limits allow: long titles and subtitles cut, at most 20 short tags. */
function fit(p: ImportPost): ImportPost {
  const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
  return {
    ...p,
    source_key: p.source_key.slice(0, 2000),
    title: cut(p.title, 300)!,
    subtitle: cut(p.subtitle, 500),
    slug: p.slug?.slice(0, 120) || undefined,
    tags: p.tags?.filter((t) => t.length <= 60).slice(0, 20),
  };
}

async function get(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { 'User-Agent': 'OpenWriter import' } });
}

/** A WordPress site's public posts, page by page, through its API. */
async function wordpressFromSite(address: string): Promise<Parsed> {
  const base = address.trim().replace(/\/+$/, '');
  const endpoints = [
    (page: number) => `${base}/wp-json/wp/v2/posts?per_page=100&_embed=1&page=${page}`,
    (page: number) => `${base}/?rest_route=/wp/v2/posts&per_page=100&_embed=1&page=${page}`,
  ];
  for (const endpoint of endpoints) {
    let res: Response;
    try {
      res = await get(endpoint(1));
    } catch {
      break;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) continue;
    const items: any[] = await res.json() as any[];
    const pages = Math.min(Number(res.headers.get('x-wp-totalpages') ?? 1) || 1, 100);
    for (let page = 2; page <= pages; page++) {
      const more = await get(endpoint(page));
      if (!more.ok) throw new Error(`${base} stopped answering at page ${page} of ${pages}. Try again, or use the export file.`);
      items.push(...((await more.json()) as any[]));
    }
    return parseWordpressApi(items);
  }
  throw new Error(`Could not read posts from ${base}. Check the address, or use the export file instead (WordPress: Tools > Export).`);
}

/** The file's bytes: a path on this computer, or content sent with the call (text, or base64 for a zip). */
function fileBytes(params: Record<string, unknown>): Buffer | null {
  if (typeof params.content_base64 === 'string' && params.content_base64) return Buffer.from(params.content_base64, 'base64');
  if (typeof params.content === 'string' && params.content) return Buffer.from(params.content, 'utf8');
  return null;
}

/** Read the source into posts, or a plain sentence saying what is missing. */
async function readSource(source: Source, params: Record<string, unknown>): Promise<Parsed | string> {
  const file = typeof params.file === 'string' ? params.file.trim() : '';
  const url = typeof params.url === 'string' ? params.url.trim() : '';
  if (file && !existsSync(file)) return `No file at ${file}.`;
  const isDir = file ? statSync(file).isDirectory() : false;
  let bytes = fileBytes(params) ?? (file && !isDir ? readFileSync(file) : null);

  switch (source) {
    case 'wordpress':
      if (bytes) return parseWordpressExport(bytes.toString('utf8'));
      if (url) return wordpressFromSite(url);
      return 'Pass file (the export from WordPress: Tools > Export), its content, or url (the site\'s address, for its public posts).';
    case 'ghost':
      if (!bytes) return 'Pass file, the JSON export from Ghost (Settings > Advanced > Export content), or its content.';
      return parseGhostExport(bytes.toString('utf8'), url || undefined);
    case 'medium': {
      if (isDir) {
        const dir = existsSync(join(file, 'posts')) ? join(file, 'posts') : file;
        const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.html'));
        return parseMediumExport(files.map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
      }
      if (!bytes) return 'Pass file: the Medium export zip (Settings > Security and apps > Download your information), its unzipped folder, or one post\'s .html file; or content_base64 with the zip.';
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) return parseMediumExport(unzipMediumPosts(bytes));
      return parseMediumExport([[file || 'post.html', bytes.toString('utf8')]]);
    }
    case 'rss':
      if (!bytes && url) {
        const res = await get(url).catch(() => null);
        if (!res?.ok) return `Could not read the feed at ${url}${res ? ` (${res.status})` : ''}. Check the address.`;
        bytes = Buffer.from(await res.arrayBuffer());
      }
      if (!bytes) return 'Pass url, the feed\'s address, or file with a saved feed.';
      return parseFeed(bytes.toString('utf8'));
  }
}

/** Posts in groups the API takes in one request. */
function batches(posts: ImportPost[]): ImportPost[][] {
  const out: ImportPost[][] = [];
  let cur: ImportPost[] = [];
  let images = 0;
  let bytes = 0;
  for (const p of posts) {
    const pImages = (p.body_html.match(/<img\b/gi)?.length ?? 0) + (p.cover_url ? 1 : 0);
    const pBytes = JSON.stringify(p).length;
    if (cur.length && (cur.length >= BATCH_POSTS || images + pImages > BATCH_IMAGES || bytes + pBytes > BATCH_BYTES)) {
      out.push(cur);
      cur = [];
      images = 0;
      bytes = 0;
    }
    cur.push(p);
    images += pImages;
    bytes += pBytes;
  }
  if (cur.length) out.push(cur);
  return out;
}

interface Result {
  source_key: string | null;
  title: string | null;
  outcome: 'imported' | 'would_import' | 'skipped' | 'failed';
  reason?: string;
  slug?: string;
  status?: 'published' | 'draft';
  published_at?: string | null;
  url?: string | null;
  images?: { copied: number; kept_remote: number };
  images_to_copy?: number;
}

interface BatchAnswer {
  results: Result[];
  images: { copied: number; kept_remote: number };
  storage?: { used_mb: number; limit_mb: number };
  storage_full?: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function siteImportTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'import_posts',
      description:
        'Import a back catalogue into the site from WordPress (the export file from Tools > Export, or the site\'s address for its public posts), ' +
        'Ghost (the JSON export), Medium (the export zip, its folder, or one post\'s .html) or any RSS or Atom feed (only the posts the feed lists). ' +
        'Keeps each post\'s title, subtitle or excerpt, text, cover, original date, address (slug) when it is free, and tags; pictures are copied ' +
        'into the site\'s image storage while it has room, and the rest stay at their old address. Posts come in published with their original ' +
        'dates or as drafts (as); posts that were drafts, private or scheduled there always come in as drafts. Nobody is emailed. Running it again ' +
        'skips posts already imported. Run with dry_run first to list what would come over. Owners and admins.',
      inputSchema: {
        type: 'object',
        properties: {
          source: { type: 'string', enum: [...SOURCES], description: 'Where the posts come from.' },
          file: {
            type: 'string',
            description: 'Path on this computer: the WordPress export (.xml), the Ghost export (.json), the Medium export (.zip, its unzipped folder, or a post\'s .html), or a saved feed.',
          },
          content: { type: 'string', description: 'The file\'s content as text, instead of file (a screen uploading the file).' },
          content_base64: { type: 'string', description: 'The file\'s content as base64, instead of file: for the Medium zip.' },
          url: {
            type: 'string',
            description: 'rss: the feed\'s address. wordpress: the site\'s address, to import its public posts without an export file. ghost: the Ghost site\'s address, so its pictures come over.',
          },
          as: { type: 'string', enum: ['published', 'draft'], description: 'published (default: draft) puts the posts on the site with their original dates; draft keeps them for you to publish one by one.' },
          dry_run: { type: 'boolean', description: 'List what would be imported and change nothing.' },
          ...SITE_PARAM,
        },
        required: ['source'],
      },
      handler: async (params) => {
        const source = params.source as Source;
        if (!SOURCES.includes(source)) return { error: `source must be one of: ${SOURCES.join(', ')}.` };
        const as = params.as === 'published' ? 'published' : 'draft';
        if (params.as !== undefined && params.as !== 'published' && params.as !== 'draft') return { error: 'as must be published or draft.' };
        const dryRun = params.dry_run === true;

        let parsed: Parsed | string;
        try {
          parsed = await readSource(source, params);
        } catch (err: any) {
          return { error: err?.message ?? String(err) };
        }
        if (typeof parsed === 'string') return { error: parsed };
        const notes = [...parsed.notes];
        if (!parsed.posts.length) return { error: `No posts found in ${NAMES[source]}.`, notes };

        const results: Result[] = [];
        const images = { copied: 0, kept_remote: 0, to_copy: 0 };
        let storage: BatchAnswer['storage'];
        let copyImages = true;
        const groups = batches(parsed.posts.map(fit));
        for (const [g, posts] of groups.entries()) {
          const res = await publishFetch(config, '/sites/import/posts', onSite(params.site, {
            method: 'POST',
            body: JSON.stringify({ source, as, dry_run: dryRun, copy_images: copyImages, posts }),
          }));
          if (!res.ok) {
            if (g === 0) return apiError(res, 'Import failed');
            const why = (await apiError(res, 'The import stopped')).error;
            notes.push(`${why}. ${plural(groups.slice(g).flat().length, 'post was', 'posts were')} not tried. Run it again: posts already imported are skipped.`);
            break;
          }
          const answer = (await res.json()) as BatchAnswer;
          results.push(...answer.results);
          images.copied += answer.images.copied;
          images.kept_remote += answer.images.kept_remote;
          images.to_copy += answer.results.reduce((n, r) => n + (r.images_to_copy ?? 0), 0);
          if (answer.storage) storage = answer.storage;
          if (answer.storage_full && copyImages) {
            copyImages = false;
            notes.push(`Your image storage is full (${answer.storage?.used_mb} of ${answer.storage?.limit_mb} MB), so the rest of the pictures stay at their old address on ${NAMES[source]}. They show as long as that site keeps them.`);
          }
        }

        const count = (o: Result['outcome']) => results.filter((r) => r.outcome === o).length;
        const done = results.filter((r) => r.outcome === (dryRun ? 'would_import' : 'imported'));
        const published = done.filter((r) => r.status === 'published').length;
        const what = done.length ? `${plural(done.length, 'post')} (${published} published, ${plural(done.length - published, 'draft')})` : 'no new posts';
        const skipped = count('skipped');
        const failed = count('failed');
        const tail = [skipped ? `${plural(skipped, 'was', 'were')} imported before` : '', failed ? `${failed} could not be imported` : '']
          .filter(Boolean).join('; ');
        const message = dryRun
          ? `Would import ${what}${tail ? `; ${tail}` : ''}. Nothing was changed.`
          : `Imported ${what}${tail ? `; ${tail}` : ''}. Nobody was emailed.`;
        if (!dryRun && images.kept_remote && copyImages) {
          notes.push(`${plural(images.kept_remote, 'picture')} could not be copied (missing, too large, or not an image) and ${images.kept_remote === 1 ? 'stays' : 'stay'} at the old address.`);
        }

        return {
          success: true,
          source,
          dry_run: dryRun,
          as,
          found: parsed.posts.length,
          message,
          counts: dryRun ? { would_import: done.length, skipped, failed } : { imported: done.length, skipped, failed },
          images: dryRun ? { to_copy: images.to_copy } : { copied: images.copied, kept_remote: images.kept_remote },
          ...(storage ? { storage } : {}),
          posts: results.map((r) => ({
            title: r.title,
            outcome: r.outcome,
            ...(r.reason ? { reason: r.reason } : {}),
            ...(r.status ? { status: r.status } : {}),
            ...(r.published_at !== undefined ? { date: r.published_at } : {}),
            ...(r.slug ? { slug: r.slug } : {}),
            ...(r.url ? { url: r.url } : {}),
            ...(r.images ? { images: r.images } : {}),
          })),
          notes,
        };
      },
    },
  ];
}
