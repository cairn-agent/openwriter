/**
 * Email subscribers without publishing a post: one reader, or everyone matching the list's
 * filter. It counts first (a dry run), then the button names the count and asks once. The
 * message is never shown on the site; it carries the usual unsubscribe footer.
 */
import { useState } from 'react';
import { count, day, run, useTool } from './api';
import { ActionBtn, Btn, Empty, Field, Notice, Row, Rows, Section } from './ui';

export function EmailComposer({ to, target, onSent }: { to: string; target: Record<string, unknown>; onSent?: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [check, setCheck] = useState<{ recipients: number; can_send: boolean; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const ready = subject.trim() && body.trim();
  const args = { ...target, subject: subject.trim(), body: body.trim() };
  const dry = async () => {
    setChecking(true);
    try { setCheck(await run('email_subscribers', { ...args, dry_run: true })); }
    catch (err: any) { setCheck({ recipients: 0, can_send: false, message: err?.message || 'That did not work.' }); }
    finally { setChecking(false); }
  };
  return (
    <Section title={`Email ${to}`}>
      <p className="ows-sub">A one-off email, not a post: it is not shown on your site.</p>
      <Field label="Subject"><input className="ows-input" value={subject} onChange={(e) => { setSubject(e.target.value); setCheck(null); }} /></Field>
      <Field label="Message" hint="Plain text or markdown: **bold**, *italic*, [a link](https://...). A blank line starts a new paragraph.">
        <textarea className="ows-input" rows={8} value={body} onChange={(e) => { setBody(e.target.value); setCheck(null); }} />
      </Field>
      {check && <Notice kind={check.can_send ? 'info' : 'warn'}>{check.message}</Notice>}
      <div className="ows-actions">
        {!check?.can_send && <Btn kind="primary" disabled={!ready || checking} onClick={() => void dry()}>{checking ? 'Counting...' : 'Check who gets it'}</Btn>}
        {check?.can_send && (
          <ActionBtn kind="primary" label={`Send to ${count(check.recipients, 'person', 'people')}`} doing="Sending..."
            confirm={`Send "${subject.trim()}" to ${count(check.recipients, 'person', 'people')}? An email cannot be recalled.`} yes="Send"
            run={() => run('email_subscribers', args)}
            done={(r) => { setSubject(''); setBody(''); setCheck(null); onSent?.(); return r?.message || 'Sending.'; }} />
        )}
      </div>
    </Section>
  );
}

export function SentMessages() {
  const list = useTool<{ messages: any[]; total: number }>('list_sent_messages', { limit: 50 });
  if (list.loading && !list.data) return null;
  if (!list.data?.messages.length) return <Section title="Sent messages"><Empty>No one-off emails sent yet.</Empty></Section>;
  return (
    <Section title="Sent messages">
      <Rows>
        {list.data.messages.map((m) => (
          <Row key={m.id} title={m.subject} meta={[m.to, day(m.sent_at), m.status !== 'sent' ? m.status : null].filter(Boolean).join(' · ')}
            aside={<span className="ows-row-stats">{count(m.recipients, 'recipient')} · {count(m.opens, 'open')}</span>} />
        ))}
      </Rows>
    </Section>
  );
}
