/**
 * Readers for the formats import_posts takes: a WordPress export (WXR) or a WordPress site's
 * public API answers, a Ghost JSON export, the posts in a Medium export, and RSS or Atom feeds.
 * Each turns its input into the post shape the site API stores (POST /sites/import/posts).
 * Pure: no files and no network, so each reader can be checked with a string.
 */

import { inflateRawSync } from 'zlib';

/** One post as the site API takes it. */
export interface ImportPost {
  /** Its id on the old platform (guid, id or address): what makes a second run skip it. */
  source_key: string;
  title: string;
  subtitle?: string;
  body_html: string;
  cover_url?: string;
  published_at?: string;
  slug?: string;
  tags?: string[];
  /** Not public there (draft, private, scheduled, password-protected): always a draft here. */
  draft?: boolean;
  audience?: 'everyone' | 'subscribers' | 'paid';
}

export interface Parsed {
  posts: ImportPost[];
  /** Plain sentences about what was left out or needs the writer's attention. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©', reg: '®', trade: '™',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (whole, hex?: string, dec?: string, named?: string) => {
    if (named) return NAMED[named.toLowerCase()] ?? whole;
    const code = hex ? parseInt(hex, 16) : parseInt(dec!, 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** HTML (or text with entities) as one line of plain text. */
export function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * An excerpt as a subtitle, unless the platform cut it from the text itself: it ends in "[…]",
 * "Read more" or "appeared first on", or it is how the text begins.
 */
function excerptSubtitle(html: string | undefined, body: string, max = 300): string | undefined {
  if (!html || /\[(?:&hellip;|&#8230;|…|\.\.\.)\]|more-link|continue reading|read more|appeared first on/i.test(html)) return undefined;
  const t = plainText(html);
  if (!t || t.length > max || plainText(body).startsWith(t.slice(0, 60))) return undefined;
  return t;
}

/** The text without a first heading that only repeats the title (Medium puts one there). */
function withoutTitleHeading(html: string, title: string): string {
  const m = html.match(/^\s*<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
  return m && plainText(m[1]) === title ? html.slice(m[0].length) : html;
}

/** A date the site API can read, or nothing. */
function isoDate(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The last path segment of an address, as a slug: /2019/05/my-post/ and /p/my-post give my-post. */
function slugFromLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try {
    const url = new URL(link);
    const parts = url.pathname.split('/').filter(Boolean);
    let last = parts.at(-1)?.replace(/\.html?$/i, '');
    // Medium ends each address with the story's id: /my-story-abc123def456.
    if (/(^|\.)medium\.com$/i.test(url.hostname)) last = last?.replace(/-[0-9a-f]{8,12}$/, '');
    return last && !/^\d+$/.test(last) ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

function uniqueTags(names: string[]): string[] | undefined {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = plainText(raw);
    if (!name || name.toLowerCase() === 'uncategorized' || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------
// XML: a small tolerant reader, enough for feeds and WordPress exports
// ---------------------------------------------------------------------------

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text and CDATA directly inside, entities decoded. */
  text: string;
  /** The raw markup inside the element (Atom's xhtml content). */
  inner: string;
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '', inner: xml };
  const stack: { node: XmlNode; start: number }[] = [{ node: root, start: 0 }];
  const top = () => stack[stack.length - 1].node;
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      top().text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top().text += decodeEntities(xml.slice(i, lt));
    const skipTo = (end: string) => {
      const at = xml.indexOf(end, lt);
      return at < 0 ? xml.length : at + end.length;
    };
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      top().text += xml.slice(lt + 9, end < 0 ? xml.length : end);
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) { i = skipTo('-->'); continue; }
    if (xml.startsWith('<?', lt)) { i = skipTo('?>'); continue; }
    if (xml.startsWith('<!', lt)) {
      // A DOCTYPE, possibly with an internal subset in [ ].
      const bracket = xml.indexOf('[', lt);
      const gt = xml.indexOf('>', lt);
      i = bracket >= 0 && bracket < gt ? skipTo(']>') : skipTo('>');
      continue;
    }
    // The end of the tag, skipping quoted attribute values.
    let gt = lt + 1;
    for (let q = ''; gt < xml.length; gt++) {
      const ch = xml[gt];
      if (q) { if (ch === q) q = ''; } else if (ch === '"' || ch === "'") q = ch; else if (ch === '>') break;
    }
    const tag = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const at = stack.map((s) => s.node.name).lastIndexOf(name);
      if (at > 0) {
        stack[at].node.inner = xml.slice(stack[at].start, lt);
        stack.length = at;
      }
      continue;
    }
    const selfClosing = tag.endsWith('/');
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const name = body.match(/^[^\s]+/)?.[0] ?? '';
    const attrs: Record<string, string> = {};
    for (const [, k, dq, sq] of body.slice(name.length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[k] = decodeEntities(dq ?? sq ?? '');
    }
    const node: XmlNode = { name, attrs, children: [], text: '', inner: '' };
    top().children.push(node);
    if (!selfClosing) stack.push({ node, start: i });
  }
  return root;
}

const kids = (n: XmlNode | undefined, name: string) => n?.children.filter((c) => c.name === name) ?? [];
const kid = (n: XmlNode | undefined, name: string) => n?.children.find((c) => c.name === name);
const txt = (n: XmlNode | undefined, name: string) => kid(n, name)?.text.trim() || undefined;

// ---------------------------------------------------------------------------
// WordPress
// ---------------------------------------------------------------------------

const CAPTION = /\[(?:wp_)?caption\b[^\]]*\]\s*((?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*<\/a>)?)([\s\S]*?)\[\/(?:wp_)?caption\]/gi;
const SHORTCODE = /\[\/?(?:caption|wp_caption|gallery|embed|audio|video|playlist)\b[^\]]*\]/gi;
const BLOCK_START = /^<(?:p|div|h[1-6]|ul|ol|li|blockquote|pre|table|figure|hr|section)\b/i;

/** WordPress post text: block editor html as is; classic editor text gets its paragraphs, as WordPress adds them on display. */
export function wordpressBody(content: string): string {
  const s = content
    .replace(CAPTION, (_, img: string, caption: string) => `<figure>${img}${caption.trim() ? `<figcaption>${caption.trim()}</figcaption>` : ''}</figure>`)
    .replace(SHORTCODE, '');
  if (s.includes('<!-- wp:')) return s;
  return s.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean)
    .map((t) => (BLOCK_START.test(t) ? t : `<p>${t.replace(/\n/g, '<br>')}</p>`)).join('\n');
}

/** A WordPress export file (Tools > Export): every post, drafts and private posts as drafts. */
export function parseWordpressExport(xml: string): Parsed {
  const channel = kid(kid(parseXml(xml), 'rss'), 'channel');
  if (!channel) throw new Error('This is not a WordPress export file (WXR). In WordPress, use Tools > Export > All content or Posts.');
  const items = kids(channel, 'item');
  const attachments = new Map<string, string>();
  for (const it of items) {
    if (txt(it, 'wp:post_type') === 'attachment') {
      const url = txt(it, 'wp:attachment_url');
      if (url) attachments.set(txt(it, 'wp:post_id') ?? '', url);
    }
  }
  const posts: ImportPost[] = [];
  let pages = 0;
  for (const it of items) {
    const type = txt(it, 'wp:post_type');
    if (type === 'page') pages++;
    const status = txt(it, 'wp:status') ?? 'publish';
    if (type !== 'post' || ['trash', 'auto-draft', 'inherit'].includes(status)) continue;
    const meta = new Map(kids(it, 'wp:postmeta').map((m) => [txt(m, 'wp:meta_key'), txt(m, 'wp:meta_value')]));
    const gmt = txt(it, 'wp:post_date_gmt');
    const date = gmt && !gmt.startsWith('0000') ? isoDate(`${gmt.replace(' ', 'T')}Z`) : status === 'publish' ? isoDate(txt(it, 'pubDate')) : undefined;
    const name = txt(it, 'wp:post_name');
    let slug: string | undefined;
    try { slug = name ? decodeURIComponent(name) : undefined; } catch { slug = name; }
    posts.push({
      source_key: txt(it, 'guid') || txt(it, 'link') || `wordpress:${txt(it, 'wp:post_id')}`,
      title: plainText(txt(it, 'title') ?? ''),
      subtitle: plainText(txt(it, 'excerpt:encoded') ?? '') || undefined,
      body_html: wordpressBody(txt(it, 'content:encoded') ?? ''),
      cover_url: attachments.get(meta.get('_thumbnail_id') ?? ''),
      published_at: date,
      slug,
      tags: uniqueTags(kids(it, 'category').filter((c) => c.attrs.domain === 'category' || c.attrs.domain === 'post_tag').map((c) => c.text)),
      draft: status !== 'publish' || !!txt(it, 'wp:post_password'),
    });
  }
  const notes = pages ? [`${pages} page${pages === 1 ? ' was' : 's were'} left out; only posts are imported.`] : [];
  return { posts, notes };
}

/** Posts from a WordPress site's public API (/wp-json/wp/v2/posts?_embed=1): published posts only. */
export function parseWordpressApi(items: any[]): Parsed {
  const posts: ImportPost[] = [];
  let protectedPosts = 0;
  for (const p of items) {
    if (p?.content?.protected) {
      protectedPosts++;
      continue;
    }
    const embedded = p._embedded ?? {};
    const terms: any[] = (embedded['wp:term'] ?? []).flat();
    posts.push({
      source_key: decodeEntities(p.guid?.rendered ?? '') || p.link || `wordpress:${p.id}`,
      title: plainText(p.title?.rendered ?? ''),
      subtitle: excerptSubtitle(p.excerpt?.rendered, p.content?.rendered ?? '', 500),
      body_html: p.content?.rendered ?? '',
      cover_url: embedded['wp:featuredmedia']?.[0]?.source_url || undefined,
      published_at: isoDate(p.date_gmt ? `${p.date_gmt}Z` : p.date),
      slug: p.slug || undefined,
      tags: uniqueTags(terms.filter((t) => t?.taxonomy === 'category' || t?.taxonomy === 'post_tag').map((t) => String(t.name ?? ''))),
    });
  }
  const notes = ['Only public posts come through the site\'s address. For drafts and private posts too, use the export file (WordPress: Tools > Export).'];
  if (protectedPosts) notes.push(`${protectedPosts} password-protected post${protectedPosts === 1 ? ' was' : 's were'} left out: the site does not show their text. The export file has them.`);
  return { posts, notes };
}

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------

const GHOST_AUDIENCE: Record<string, ImportPost['audience']> = { public: 'everyone', members: 'subscribers', paid: 'paid', tiers: 'paid' };

/**
 * A Ghost export (Settings > Advanced > Export content). siteUrl is the Ghost site's address, which
 * Ghost writes as __GHOST_URL__ in front of its own pictures and links.
 */
export function parseGhostExport(json: string, siteUrl?: string): Parsed {
  let doc: any;
  try { doc = JSON.parse(json); } catch { throw new Error('This is not a Ghost export: it is not JSON. In Ghost, use Settings > Advanced > Export content.'); }
  const data = doc?.db?.[0]?.data ?? doc?.data;
  if (!Array.isArray(data?.posts)) throw new Error('This is not a Ghost export: it has no posts. In Ghost, use Settings > Advanced > Export content.');
  const base = siteUrl?.trim().replace(/\/+$/, '');
  const fix = (s: string) => (base ? s.replaceAll('__GHOST_URL__', base) : s);
  const tagNames = new Map<string, string>((data.tags ?? []).map((t: any) => [t.id, String(t.name ?? '')]));
  const tagsOf = new Map<string, { name: string; order: number }[]>();
  for (const pt of data.posts_tags ?? []) {
    const name = tagNames.get(pt.tag_id);
    if (!name || name.startsWith('#')) continue; // #internal tags are Ghost's own
    tagsOf.set(pt.post_id, [...(tagsOf.get(pt.post_id) ?? []), { name, order: pt.sort_order ?? 0 }]);
  }

  const posts: ImportPost[] = [];
  let pages = 0;
  let noHtml = 0;
  let ghostImages = false;
  for (const p of data.posts) {
    if (p.type === 'page' || p.page === true || p.page === 1) { pages++; continue; }
    if (typeof p.html !== 'string') { noHtml++; continue; }
    if (!base && (p.html.includes('__GHOST_URL__') || String(p.feature_image ?? '').includes('__GHOST_URL__'))) ghostImages = true;
    const cover = p.feature_image ? fix(String(p.feature_image)) : undefined;
    posts.push({
      source_key: String(p.id ?? p.uuid),
      title: plainText(String(p.title ?? '')),
      subtitle: p.custom_excerpt ? plainText(String(p.custom_excerpt)) : undefined,
      // Ghost marks where a members-only post's free preview ends.
      body_html: fix(p.html).replace(/<!--\s*members-only\s*-->/i, '<!-- paywall -->'),
      cover_url: cover && /^https?:\/\//i.test(cover) ? cover : undefined,
      published_at: p.status === 'published' ? isoDate(p.published_at) : undefined,
      slug: p.slug || undefined,
      tags: uniqueTags((tagsOf.get(p.id) ?? []).sort((a, b) => a.order - b.order).map((t) => t.name)),
      draft: p.status !== 'published',
      audience: GHOST_AUDIENCE[p.visibility] ?? 'everyone',
    });
  }
  const notes: string[] = [];
  if (pages) notes.push(`${pages} page${pages === 1 ? ' was' : 's were'} left out; only posts are imported.`);
  if (noHtml) notes.push(`${noHtml} post${noHtml === 1 ? ' has' : 's have'} no text in the export and ${noHtml === 1 ? 'was' : 'were'} left out.`);
  if (ghostImages) notes.push('Pass url, your Ghost site\'s address, so pictures and links stored on Ghost come over; without it they are left out.');
  if (posts.some((p) => p.draft)) notes.push('Ghost drafts, scheduled posts and email-only posts come over as drafts.');
  return { posts, notes };
}

// ---------------------------------------------------------------------------
// Medium
// ---------------------------------------------------------------------------

/** One post file from a Medium export (posts/*.html). Drafts are the files named draft_... */
export function parseMediumPost(html: string, fileName: string): ImportPost | null {
  const title = html.match(/<h1[^>]*class="p-name"[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const open = html.match(/<section[^>]*data-field="body"[^>]*>/i);
  if (title === undefined || !open) return null;
  const start = open.index! + open[0].length;
  const footer = html.indexOf('<footer', start);
  const end = html.lastIndexOf('</section>', footer < 0 ? html.length : footer);
  const body = html.slice(start, end > start ? end : html.length)
    // Medium repeats the title and subtitle at the top of the text, and opens with a section rule.
    .replace(/<h\d[^>]*class="[^"]*graf--(?:title|subtitle)[^"]*"[^>]*>[\s\S]*?<\/h\d>/gi, '')
    .replace(/<div class="section-divider">\s*<hr[^>]*>\s*<\/div>/i, '');
  const subtitle = html.match(/<section[^>]*data-field="subtitle"[^>]*>([\s\S]*?)<\/section>/i)?.[1];
  const canonical = html.match(/<a[^>]*href="([^"]+)"[^>]*class="p-canonical"/i)?.[1];
  const short = html.match(/href="(https:\/\/medium\.com\/p\/[0-9a-f]+)"/i)?.[1];
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return {
    // The /p/<id> address is also the guid in Medium's RSS feed, so the two never import a post twice.
    source_key: short || canonical || `medium:${base}`,
    title: plainText(title),
    subtitle: subtitle ? plainText(subtitle) || undefined : undefined,
    body_html: body,
    published_at: isoDate(html.match(/<time[^>]*class="dt-published"[^>]*datetime="([^"]+)"/i)?.[1]),
    slug: slugFromLink(canonical)?.replace(/-[0-9a-f]{8,12}$/, ''),
    draft: base.startsWith('draft_'),
  };
}

/** Every post in a Medium export: files as [name, html]. */
export function parseMediumExport(files: [string, string][]): Parsed {
  const posts: ImportPost[] = [];
  let unreadable = 0;
  for (const [name, html] of files) {
    const post = parseMediumPost(html, name);
    if (post) posts.push(post); else unreadable++;
  }
  const notes = ['Medium exports also hold your responses (comments on other stories) as posts; check the list before importing.'];
  if (unreadable) notes.push(`${unreadable} file${unreadable === 1 ? ' was' : 's were'} not a Medium post and ${unreadable === 1 ? 'was' : 'were'} left out.`);
  return { posts, notes };
}

/** The posts/*.html files of a Medium export zip. Stored and deflated entries; no zip64. */
export function unzipMediumPosts(zip: Buffer): [string, string][] {
  let eocd = -1;
  for (let p = zip.length - 22; p >= Math.max(0, zip.length - 65557); p--) {
    if (zip.readUInt32LE(p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error('This file is not a zip. Pass the Medium export zip, its unzipped folder, or one post\'s .html file.');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error('This zip is too large to read here. Unzip it and pass the folder.');
  const out: [string, string][] = [];
  for (let n = 0; n < count && zip.readUInt32LE(p) === 0x02014b50; n++) {
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
    if (!/(^|\/)posts\/[^/]+\.html$/i.test(name) || zip.readUInt32LE(local) !== 0x04034b50) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (method === 0) out.push([name, data.toString('utf8')]);
    else if (method === 8) out.push([name, inflateRawSync(data).toString('utf8')]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// RSS and Atom
// ---------------------------------------------------------------------------

const FEED_NOTE = 'A feed holds only the posts it lists, often just the latest 10 to 50. For the whole archive, import the platform\'s export file.';

/** An RSS 2.0, RSS 1.0 or Atom feed. */
export function parseFeed(xml: string): Parsed {
  const root = parseXml(xml);
  const rss = kid(root, 'rss') ?? kid(root, 'rdf:RDF');
  const atom = kid(root, 'feed');
  if (!rss && !atom) throw new Error('This is not an RSS or Atom feed.');
  const posts: ImportPost[] = [];

  if (rss) {
    const items = [...kids(kid(rss, 'channel'), 'item'), ...kids(rss, 'item')];
    for (const it of items) {
      const content = txt(it, 'content:encoded');
      const description = txt(it, 'description');
      const link = txt(it, 'link');
      const media = [...kids(it, 'media:content'), ...kids(it, 'media:thumbnail'), ...kids(it, 'enclosure')]
        .find((m) => m.attrs.url && (m.name === 'media:thumbnail' || /^image\//.test(m.attrs.type ?? '') || m.attrs.medium === 'image'));
      const title = plainText(txt(it, 'title') ?? '');
      posts.push({
        source_key: txt(it, 'guid') || link || title,
        title,
        subtitle: content ? excerptSubtitle(description, content) : undefined,
        body_html: withoutTitleHeading(content ?? description ?? '', title),
        cover_url: media?.attrs.url,
        published_at: isoDate(txt(it, 'pubDate') ?? txt(it, 'dc:date')),
        slug: slugFromLink(link),
        tags: uniqueTags(kids(it, 'category').map((c) => c.text)),
      });
    }
  } else {
    for (const e of kids(atom, 'entry')) {
      const links = kids(e, 'link');
      const link = (links.find((l) => (l.attrs.rel ?? 'alternate') === 'alternate') ?? links[0])?.attrs.href;
      const body = (n: XmlNode | undefined) => (n ? (n.attrs.type === 'xhtml' ? n.inner : n.text) : undefined);
      const content = body(kid(e, 'content'));
      const summary = body(kid(e, 'summary'));
      const title = plainText(txt(e, 'title') ?? '');
      posts.push({
        source_key: txt(e, 'id') || link || title,
        title,
        subtitle: content ? excerptSubtitle(summary, content) : undefined,
        body_html: withoutTitleHeading((content ?? summary ?? '').trim(), title),
        cover_url: kids(e, 'media:thumbnail')[0]?.attrs.url,
        published_at: isoDate(txt(e, 'published') ?? txt(e, 'updated')),
        slug: slugFromLink(link),
        tags: uniqueTags(kids(e, 'category').map((c) => c.attrs.term ?? c.attrs.label ?? '')),
      });
    }
  }
  return { posts, notes: [FEED_NOTE] };
}
