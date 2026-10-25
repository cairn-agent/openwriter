/**
 * Comments: the reported queue first (approve or delete each), every comment with Pin and Delete,
 * and banned readers: ban one or a list, see who is banned, lift a ban.
 */
import { useState } from 'react';
import { count, day, run, useTool } from '../api';
import { ActionBtn, Empty, Failed, Field, Loading, Page, Row, Rows, Section, Tabs, Toggle } from '../ui';

type View = 'reported' | 'all' | 'banned';

function excerpt(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > 280 ? `${t.slice(0, 280)}...` : t;
}

function CommentList({ reported }: { reported: boolean }) {
  const list = useTool<{ comments: any[] }>('list_site_comments', { reported, limit: 100 });
  if (list.loading && !list.data) return <Loading what="comments" />;
  if (list.error) return <Failed error={list.error} retry={list.reload} />;
  const comments = list.data?.comments || [];
  if (!comments.length) return <Empty>{reported ? 'Nothing reported. When readers report a comment it waits here for you.' : 'No comments yet.'}</Empty>;
  return (
    <Rows>
      {comments.map((c) => {
        const who = c.reader?.name || c.reader?.email || 'A reader';
        return (
          <Row key={c.id} title={<span className="ows-comment">{excerpt(c.body)}</span>}
            meta={[who, c.reader?.name ? c.reader.email : null, `on "${c.post_title || 'a post'}"`, day(c.created_at),
              c.report_count ? `reported ${count(c.report_count, 'time')}` : null, c.pinned ? 'Pinned' : null].filter(Boolean).join(' · ')}
            actions={<>
              {reported && (
                <ActionBtn kind="primary" label="Keep it" doing="Approving..." run={() => run('approve_site_comment', { comment_id: c.id })}
                  done={() => { list.reload(); return `Kept ${who}'s comment and cleared its reports.`; }} />
              )}
              {!reported && (
                <ActionBtn kind="quiet" label={c.pinned ? 'Unpin' : 'Pin'} doing="Saving..." run={() => run('pin_site_comment', { comment_id: c.id, pinned: !c.pinned })}
                  done={() => { list.reload(); return c.pinned ? 'Unpinned.' : 'Pinned to the top of the post\'s comments.'; }} />
              )}
              <ActionBtn kind="danger" label="Delete" doing="Deleting..." confirm={`Delete ${who}'s comment? Readers stop seeing it.`} yes="Delete"
                run={() => run('delete_site_comment', { comment_id: c.id })} done={() => { list.reload(); return `Deleted ${who}'s comment.`; }} />
              {c.reader?.email && (
                <ActionBtn kind="danger" label="Ban" doing="Banning..."
                  confirm={`Ban ${c.reader.email}? They are unsubscribed, cannot subscribe or comment again, and their comments here are deleted. Paid access is kept until you cancel it.`} yes="Ban"
                  run={() => run('ban_readers', { emails: [c.reader.email], delete_comments: true })}
                  done={(r) => { list.reload(); return r?.note || `Banned ${c.reader.email}.`; }} />
              )}
            </>} />
        );
      })}
    </Rows>
  );
}

function Banned() {
  const bans = useTool<{ bans: any[]; total: number }>('list_banned_readers', { limit: 200 });
  const [emails, setEmails] = useState('');
  const [reason, setReason] = useState('');
  const [wipe, setWipe] = useState(false);
  const list = emails.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => e.includes('@'));
  return (
    <>
      <Section title="Ban readers">
        <Field label="Emails" hint="One or many, separated by spaces, commas or new lines.">
          <textarea className="ows-input" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} />
        </Field>
        <Field label="Reason (only you see it)"><input className="ows-input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Toggle label="Also delete their comments" checked={wipe} onChange={setWipe} />
        <ActionBtn kind="danger" label={list.length ? `Ban ${count(list.length, 'reader')}` : 'Ban'} doing="Banning..." disabled={!list.length}
          confirm={`Ban ${count(list.length, 'reader')}? They are unsubscribed and cannot subscribe, comment or like again. Paid access is kept until you cancel it.`} yes="Ban"
          run={() => run('ban_readers', { emails: list, ...(reason.trim() ? { reason: reason.trim() } : {}), delete_comments: wipe })}
          done={(r) => {
            setEmails(''); setReason(''); bans.reload();
            const bits = [`Banned ${count(r?.banned ?? list.length, 'reader')}`];
            if (r?.already_banned) bits.push(`${r.already_banned} already banned`);
            if (r?.invalid?.length) bits.push(`${r.invalid.length} not an email`);
            return `${bits.join(', ')}.${r?.note ? ` ${r.note}` : ''}`;
          }} />
      </Section>
      <Section title="Banned">
        {bans.loading && !bans.data && <Loading what="banned readers" />}
        {bans.error && <Failed error={bans.error} retry={bans.reload} />}
        {bans.data && !bans.data.bans.length && <Empty>Nobody is banned.</Empty>}
        {bans.data && bans.data.bans.length > 0 && (
          <Rows>
            {bans.data.bans.map((b) => (
              <Row key={b.email} title={b.email} meta={[day(b.created_at), b.reason].filter(Boolean).join(' · ')}
                actions={<ActionBtn kind="quiet" label="Lift ban" doing="Lifting..." confirm={`Lift the ban on ${b.email}? They can subscribe again; they are not re-subscribed for them.`} yes="Lift ban"
                  run={() => run('unban_reader', { email: b.email })} done={() => { bans.reload(); return `${b.email} can subscribe again.`; }} />} />
            ))}
          </Rows>
        )}
      </Section>
    </>
  );
}

export default function Comments() {
  const [view, setView] = useState<View>('reported');
  return (
    <Page title="Comments">
      <Tabs label="Comments" value={view} onChange={setView} options={[
        { value: 'reported', label: 'Reported' }, { value: 'all', label: 'All comments' }, { value: 'banned', label: 'Banned readers' },
      ]} />
      {view === 'reported' && <CommentList reported />}
      {view === 'all' && <CommentList reported={false} />}
      {view === 'banned' && <Banned />}
    </Page>
  );
}
