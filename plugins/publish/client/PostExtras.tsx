/**
 * Posts extras: cross-posts (another site's post shown on your homepage with your note, the
 * original keeps the credit and the comments) and a post's poll results.
 */
import { useState } from 'react';
import { count, day, run, useTool } from './api';
import { ActionBtn, Dialog, Empty, Failed, Field, Loading, Row, Rows, Section, Toggle } from './ui';

export function CrossPosts() {
  const list = useTool<{ cross_posts: any[] }>('list_cross_posts');
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [email, setEmail] = useState(false);
  return (
    <>
      <Section title="Cross-post">
        <p className="ows-sub">Share a post from another OpenWriter site on your homepage, with a note from you. Readers open the original, and its writer keeps the credit and the comments.</p>
        <Field label="Link to the post"><input className="ows-input" placeholder="https://their-name.openwriter.io/p/..." value={url} onChange={(e) => setUrl(e.target.value.trim())} /></Field>
        <Field label="Your note (optional)" hint="Why your readers should read it.">
          <textarea className="ows-input" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Toggle label="Email it to your subscribers" hint="They get your note and a link to the post, not the post itself." checked={email} onChange={setEmail} />
        <ActionBtn kind="primary" label={email ? 'Cross-post and email' : 'Cross-post'} doing="Sharing..." disabled={!/^https?:\/\/\S+\.\S+/.test(url)}
          confirm={email ? 'Email your note and the link to your subscribers? An email cannot be recalled.' : undefined} yes="Send it"
          run={() => run('cross_post', { url, ...(note.trim() ? { note: note.trim() } : {}), ...(email ? { send_email: true } : {}) })}
          done={(r) => { setUrl(''); setNote(''); setEmail(false); list.reload(); return r?.message || 'Shared on your homepage.'; }} />
      </Section>
      <Section title="Your cross-posts">
        {list.loading && !list.data && <Loading what="cross-posts" />}
        {list.error && <Failed error={list.error} retry={list.reload} />}
        {list.data && !list.data.cross_posts.length && <Empty>Nothing cross-posted yet.</Empty>}
        {list.data && list.data.cross_posts.length > 0 && (
          <Rows>
            {list.data.cross_posts.map((x) => (
              <Row key={x.id} title={x.title}
                meta={[`From ${x.from?.name || 'another site'}`, `shared ${day(x.created_at)}`, x.emailed_at ? 'emailed' : null, x.live ? null : 'no longer available, hidden from your homepage'].filter(Boolean).join(' · ')}
                actions={<>
                  {x.live && <a className="ows-btn ows-btn--quiet" href={x.original_url} target="_blank" rel="noopener noreferrer">View</a>}
                  <ActionBtn kind="danger" label="Remove" doing="Removing..." confirm={`Take "${x.title}" off your homepage?`} yes="Remove"
                    run={() => run('remove_cross_post', { cross_post_id: x.id })} done={(r) => { list.reload(); return r?.message || 'Removed.'; }} />
                </>} />
            ))}
          </Rows>
        )}
      </Section>
    </>
  );
}

export function PollResults({ post, onClose }: { post: { id: string; title?: string }; onClose: () => void }) {
  const r = useTool<{ polls: Array<{ question: string; total_votes: number; choices: Array<{ text: string; votes: number; percent: number }> }>; note?: string }>('get_poll_results', { post_id: post.id });
  return (
    <Dialog title={`Polls in "${post.title || 'Untitled'}"`} onClose={onClose}>
      {r.loading && !r.data && <Loading what="the results" />}
      {r.error && <Failed error={r.error} retry={r.reload} />}
      {r.data && !r.data.polls.length && <Empty>{r.data.note || 'This post has no polls.'}</Empty>}
      {r.data?.polls.map((p, i) => (
        <div key={i} className="ows-poll">
          <h3 className="ows-h3">{p.question} <span className="ows-sub">{count(p.total_votes, 'vote')}</span></h3>
          {p.choices.map((c, j) => (
            <div key={j} className="ows-poll-row">
              <span className="ows-poll-bar" style={{ width: `${c.percent}%` }} />
              <span className="ows-poll-text">{c.text}</span>
              <span className="ows-poll-num">{c.percent}% · {c.votes.toLocaleString()}</span>
            </div>
          ))}
        </div>
      ))}
      {r.data && r.data.polls.length > 0 && <p className="ows-sub">Voters are never named. Each reader votes once.</p>}
    </Dialog>
  );
}
