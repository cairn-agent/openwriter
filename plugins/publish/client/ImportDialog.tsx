/**
 * Bring posts over from WordPress, Ghost, Medium or a feed (import_posts). It always lists what
 * would come over first; nothing is ever emailed, and posts already imported are skipped.
 */
import { useState } from 'react';
import { count, run } from './api';
import { Btn, Dialog, Field, Notice, Row, Rows, Tabs } from './ui';

type Source = 'wordpress' | 'ghost' | 'medium' | 'rss';
const SOURCES: Record<Source, { label: string; file?: string; accept?: string; url?: string; urlHint?: string }> = {
  wordpress: { label: 'WordPress', file: 'The export file (Tools, Export, All content)', accept: '.xml', url: "Or your site's address", urlHint: 'Public posts only, through WordPress\'s own API.' },
  ghost: { label: 'Ghost', file: 'The export file (Settings, Labs, Export)', accept: '.json', url: "Your Ghost site's address (optional)", urlHint: 'Lets pictures stored on Ghost come over.' },
  medium: { label: 'Medium', file: 'The export zip (Settings, Download your information)', accept: '.zip' },
  rss: { label: 'A feed', url: 'The feed address', urlHint: 'Only what the feed holds, often the latest 10 to 20 posts.' },
};

function toBase64(buf: ArrayBuffer): string {
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export default function ImportDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<Source>('wordpress');
  const [content, setContent] = useState<{ content?: string; content_base64?: string; name: string } | null>(null);
  const [url, setUrl] = useState('');
  const [as, setAs] = useState<'draft' | 'published'>('draft');
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState<'checking' | 'importing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cfg = SOURCES[source];
  const ready = !!content || !!url.trim();
  const args = () => ({ source, as, ...(content ? (content.content !== undefined ? { content: content.content } : { content_base64: content.content_base64 }) : {}), ...(url.trim() ? { url: url.trim() } : {}) });

  const go = async (dry: boolean) => {
    setBusy(dry ? 'checking' : 'importing'); setError(null);
    try { setResult({ ...(await run('import_posts', { ...args(), dry_run: dry })), dry }); }
    catch (err: any) { setError(err?.message || 'The import did not work.'); }
    finally { setBusy(null); }
  };

  const reset = (s: Source) => { setSource(s); setContent(null); setUrl(''); setResult(null); setError(null); };
  const done = result && !result.dry;
  return (
    <Dialog title="Import posts" onClose={onClose} wide
      footer={done ? <Btn kind="primary" onClick={onClose}>Done</Btn> : result?.dry
        ? <Btn kind="primary" disabled={!!busy || !result.counts?.would_import} onClick={() => void go(false)}>{busy ? 'Importing...' : `Import ${count(result.counts?.would_import, 'post')}`}</Btn>
        : <Btn kind="primary" disabled={!ready || !!busy} onClick={() => void go(true)}>{busy ? 'Reading...' : 'Show what comes over'}</Btn>}>
      {!result && (
        <>
          <Tabs label="From" value={source} onChange={reset} options={(Object.keys(SOURCES) as Source[]).map((s) => ({ value: s, label: SOURCES[s].label }))} />
          {cfg.file && (
            <Field label={cfg.file}>
              <input type="file" accept={cfg.accept} onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return setContent(null);
                setContent(f.name.toLowerCase().endsWith('.zip') ? { content_base64: toBase64(await f.arrayBuffer()), name: f.name } : { content: await f.text(), name: f.name });
              }} />
            </Field>
          )}
          {cfg.url && <Field label={cfg.url} hint={cfg.urlHint}><input className="ows-input" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></Field>}
          <Field label="Bring them in as">
            <Tabs label="Bring them in as" value={as} onChange={setAs} options={[{ value: 'draft', label: 'Drafts, to check first' }, { value: 'published', label: 'Published, with their dates' }]} />
          </Field>
          <p className="ows-sub">Nobody is emailed. Running it again skips posts already imported.</p>
        </>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      {result && (
        <>
          <Notice>{result.message}</Notice>
          {result.notes?.map((n: string, i: number) => <p key={i} className="ows-sub">{n}</p>)}
          <Rows>
            {(result.posts || []).map((p: any, i: number) => (
              <Row key={i} title={p.title || 'Untitled'} meta={[{ imported: 'Imported', would_import: 'Comes over', skipped: 'Skipped', failed: 'Failed' }[p.outcome as string] || p.outcome, p.reason, p.date ? new Date(p.date).toLocaleDateString() : null, p.status === 'draft' ? 'draft' : null].filter(Boolean).join(' · ')}
                actions={p.url ? <a className="ows-btn ows-btn--quiet" href={p.url} target="_blank" rel="noopener noreferrer">View</a> : undefined} />
            ))}
          </Rows>
        </>
      )}
    </Dialog>
  );
}
