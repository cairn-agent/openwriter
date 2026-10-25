/**
 * Posts: Published, Scheduled and Drafts, each row saying what it is and how it did, with View,
 * Preview (and a test email from there), a secret link for drafts, Pin, Unpublish and Delete.
 * Unpublish and Delete ask once, naming the post. Poll results where readers voted, and cross-posts.
 */
import { useEffect, useState } from 'react';
import { count, day, run, useTool, when } from '../api';
import ImportDialog from '../ImportDialog';
import PreviewDialog from '../PreviewDialog';
import { CrossPosts, PollResults } from '../PostExtras';
import { useSite } from '../SiteApp';
import { ActionBtn, Btn, Dialog, Empty, Failed, Loading, Notice, Page, Row, Rows, Tabs, Field } from '../ui';
import { showToast } from '../toast';

/** Resend an emailed post to the people who did not open it: count first, a new subject if wanted, then send once. */
function Resend({ post, onClose }: { post: any; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [check, setCheck] = useState<{ recipients?: number; can_send?: boolean; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    run('resend_post_to_unopened', { post_id: post.id, dry_run: true })
      .then(setCheck).catch((err: any) => setCheck({ can_send: false, message: err?.message || 'It cannot be resent.' }));
  }, [post.id]);
  const send = async () => {
    setBusy(true);
    try {
      const r = await run('resend_post_to_unopened', { post_id: post.id, ...(subject.trim() ? { subject: subject.trim() } : {}) });
      showToast(r?.message || 'Resending.', 'info');
      onClose();
    } catch (err: any) { showToast(err?.message || 'It was not resent.', 'error', 8000); setBusy(false); }
  };
  return (
    <Dialog title={`Resend "${post.title || 'Untitled'}"`} onClose={onClose}
      footer={check?.can_send ? <Btn kind="primary" disabled={busy} onClick={() => void send()}>{busy ? 'Sending...' : `Resend to ${count(check.recipients, 'person', 'people')}`}</Btn> : undefined}>
      {!check && <Loading what="who did not open it" />}
      {check && <Notice kind={check.can_send ? 'info' : 'warn'}>{check.message}</Notice>}
      {check?.can_send && (
        <Field label="New subject (optional)" hint="A fresh subject often does better the second time. Each post can be resent once.">
          <input className="ows-input" value={subject} placeholder={post.title} onChange={(e) => setSubject(e.target.value)} />
        </Field>
      )}
    </Dialog>
  );
}

type Status = 'published' | 'scheduled' | 'draft' | 'cross';

function meta(p: any): string {
  const bits: Array<string | null> = [
    p.status === 'scheduled' ? `Goes out ${when(p.publish_at)}` : p.status === 'draft' ? `Saved ${day(p.updated_at)}` : day(p.published_at),
    p.audience === 'paid' ? 'Paid' : p.audience === 'founding' ? 'Founding' : null,
    p.email_only ? 'Email only' : p.web_only ? 'Web only' : null,
    p.pinned ? 'Pinned' : null,
  ];
  return bits.filter(Boolean).join(' · ');
}

function numbers(p: any): string | null {
  if (!p.stats) return null;
  const e = p.stats.email;
  const parts = [`${(p.stats.views ?? 0).toLocaleString()} views`];
  if (e) parts.push(`${count(e.recipients, 'recipient')}`, `${e.open_rate ?? '-'}% opened`, `${e.click_rate ?? '-'}% clicked`);
  if (p.stats.members_gained) parts.push(`${count(p.stats.members_gained, 'new subscriber')}`);
  return parts.join(' · ');
}

export default function Posts() {
  const { info } = useSite();
  const manager = info.role !== 'contributor';
  const [status, setStatus] = useState<Status>('published');
  const [preview, setPreview] = useState<any | null>(null);
  const [resend, setResend] = useState<any | null>(null);
  const [importing, setImporting] = useState(false);
  const [polls, setPolls] = useState<any | null>(null);
  const posts = useTool<{ posts: any[] }>('list_site_posts', { status: status === 'cross' ? 'published' : status, limit: 100 });

  const empty = {
    published: 'Nothing published yet. Open a document and press Publish to put it on your site.',
    scheduled: 'Nothing scheduled. When you publish, choose Schedule to send a post later.',
    draft: 'No drafts on your site. Saving a draft on the site lets you preview it and share a secret link before you publish.',
    cross: '',
  }[status];

  return (
    <Page title="Posts" actions={manager ? <Btn onClick={() => setImporting(true)}>Import posts</Btn> : undefined}>
      <Tabs label="Posts" value={status} onChange={setStatus} options={[
        { value: 'published', label: 'Published' },
        { value: 'scheduled', label: 'Scheduled' },
        { value: 'draft', label: 'Drafts' },
        ...(manager ? [{ value: 'cross' as const, label: 'Cross-posts' }] : []),
      ]} />
      {status === 'cross' && <CrossPosts />}
      {status !== 'cross' && posts.loading && !posts.data && <Loading what="posts" />}
      {status !== 'cross' && posts.error && <Failed error={posts.error} retry={posts.reload} />}
      {status !== 'cross' && posts.data && posts.data.posts.length === 0 && <Empty>{empty}</Empty>}
      {status !== 'cross' && posts.data && posts.data.posts.length > 0 && (
        <Rows>
          {posts.data.posts.map((p) => {
            const name = `"${p.title || 'Untitled'}"`;
            return (
              <Row key={p.id} title={p.title || 'Untitled'} meta={<>{meta(p)}{numbers(p) && <><br />{numbers(p)}</>}</>}
                actions={<>
                  {p.url && <a className="ows-btn ows-btn--quiet" href={p.url} target="_blank" rel="noopener noreferrer">View</a>}
                  <button type="button" className="ows-btn ows-btn--quiet" onClick={() => setPreview(p)}>Preview</button>
                  {p.stats?.poll_votes > 0 && <button type="button" className="ows-btn ows-btn--quiet" onClick={() => setPolls(p)}>Poll results</button>}
                  {p.status === 'published' && p.emailed_at && <button type="button" className="ows-btn ows-btn--quiet" onClick={() => setResend(p)}>Resend to unopened</button>}
                  {p.status === 'draft' && (
                    <ActionBtn kind="quiet" label="Copy secret link" doing="Making the link..."
                      run={async () => {
                        const r = await run<{ url: string }>('get_post_share_link', { post_id: p.id });
                        await navigator.clipboard?.writeText(r.url).catch(() => {});
                        return r;
                      }}
                      done={(r) => `Copied. Anyone with the link can read this draft: ${r.url}`} />
                  )}
                  {manager && p.status === 'published' && (
                    <ActionBtn kind="quiet" label={p.pinned ? 'Unpin' : 'Pin'} doing={p.pinned ? 'Unpinning...' : 'Pinning...'}
                      run={() => run('pin_site_post', { post_id: p.id, pinned: !p.pinned })}
                      done={() => { posts.reload(); return p.pinned ? `Unpinned ${name}.` : `Pinned ${name} to the top of your homepage.`; }} />
                  )}
                  {manager && p.status !== 'draft' && (
                    <ActionBtn kind="quiet" label="Unpublish" doing="Unpublishing..."
                      confirm={`Unpublish ${name}? It leaves your site and becomes a draft. Emails already sent stay sent.`} yes="Unpublish"
                      run={() => run('unpublish_site_post', { post_id: p.id })}
                      done={() => { posts.reload(); return `Unpublished ${name}. It is in Drafts.`; }} />
                  )}
                  {manager && (
                    <ActionBtn kind="danger" label="Delete" doing="Deleting..."
                      confirm={`Delete ${name} for good? Readers who open its link see a missing page. Emails already sent stay sent. Your document is not touched.`} yes="Delete"
                      run={() => run('delete_site_post', { post_id: p.id })}
                      done={() => { posts.reload(); return `Deleted ${name}.`; }} />
                  )}
                </>} />
            );
          })}
        </Rows>
      )}
      {importing && <ImportDialog onClose={() => { setImporting(false); posts.reload(); }} />}
      {polls && <PollResults post={polls} onClose={() => setPolls(null)} />}
      {resend && <Resend post={resend} onClose={() => { setResend(null); posts.reload(); }} />}
      {preview && <PreviewDialog postId={preview.id} title={preview.title || 'Untitled'} paid={preview.audience !== 'everyone'} onClose={() => setPreview(null)} />}
    </Page>
  );
}
