/**
 * Money's extras: pause paid billing for a break, pledges before Stripe is on (and emailing the
 * pledgers once plans open), and emailing an offer's link to a group.
 */
import { useState } from 'react';
import { count, day, money, run, useTool } from './api';
import { ActionBtn, Btn, Dialog, Empty, Field, Notice, Row, Rows, Section, Toggle } from './ui';
import { showToast } from './toast';

export function PauseBilling({ p, reload }: { p: any; reload: () => void }) {
  const paused = p.billing_paused;
  const [until, setUntil] = useState('');
  if (paused) {
    return (
      <Section title="Billing is paused">
        <p className="ows-sub">Since {day(paused.since)}{paused.resume_at ? `, until ${day(paused.resume_at)}` : ', until you resume it'}. Paid readers keep their access and are not charged; new paid signups are closed.</p>
        <ActionBtn kind="primary" label="Resume billing now" doing="Resuming..."
          confirm="Resume billing? Paid readers are charged again from their next renewal." yes="Resume"
          run={() => run('resume_billing')} done={(r) => { reload(); return r?.message || 'Billing resumed.'; }} />
      </Section>
    );
  }
  return (
    <Section title="Taking a break?">
      <p className="ows-sub">Pause billing and nobody is charged while you are away. Paid readers keep their access; new paid signups close until you resume.</p>
      <Field label="Resume on (optional)" hint="Leave empty to resume by hand.">
        <input className="ows-input ows-select-sm" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
      </Field>
      <ActionBtn label="Pause billing" doing="Pausing..."
        confirm={`Pause billing for every paid subscriber${until ? ` until ${new Date(`${until}T00:00:00`).toLocaleDateString()}` : ''}? Their next charges are skipped.`} yes="Pause"
        run={() => run('pause_billing', until ? { resume_at: new Date(`${until}T00:00:00`).toISOString() } : {})}
        done={(r) => { reload(); return r?.message || 'Billing paused.'; }} />
    </Section>
  );
}

export function Pledges({ connected }: { connected: boolean }) {
  const pl = useTool<any>('list_pledges', { limit: 100 });
  const [monthly, setMonthly] = useState('');
  const [annual, setAnnual] = useState('');
  if (pl.loading && !pl.data) return null;
  if (pl.error) return null;
  const d = pl.data;
  const s = d.settings || {};
  const save = async (patch: Record<string, unknown>) => {
    try { await run('set_pledges', patch); pl.reload(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
  };
  if (connected && !d.count) return null;
  return (
    <Section title="Pledges">
      {!connected && (
        <>
          <p className="ows-sub">Before you turn on payments, readers can pledge to pay. You see who would pay and how much, then invite them when your plans open.</p>
          <Toggle label="Let readers pledge" checked={!!s.enabled} onChange={(v) => void save({ enabled: v })} />
          {s.enabled && (
            <div className="ows-grid3">
              <Field label="Monthly price" hint={money(s.monthly, s.currency)}><input className="ows-input" inputMode="decimal" placeholder={String((s.monthly || 500) / 100)} value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
              <Field label="Yearly price" hint={money(s.annual, s.currency)}><input className="ows-input" inputMode="decimal" placeholder={String((s.annual || 5000) / 100)} value={annual} onChange={(e) => setAnnual(e.target.value)} /></Field>
              <div className="ows-field"><span className="ows-field-label">&nbsp;</span>
                <Btn disabled={!monthly && !annual} onClick={() => void save({ ...(monthly ? { monthly: Math.round(parseFloat(monthly) * 100) } : {}), ...(annual ? { annual: Math.round(parseFloat(annual) * 100) } : {}) })}>Save prices</Btn>
              </div>
            </div>
          )}
        </>
      )}
      {d.count > 0 && (
        <p className="ows-sub">{count(d.confirmed ?? d.count, 'pledge')} confirmed, worth {money(d.monthly_revenue, d.currency)} a month.{d.waiting_confirmation ? ` ${d.waiting_confirmation} waiting to confirm their email.` : ''}</p>
      )}
      {connected && d.can_email && (
        <ActionBtn kind="primary" label={`Invite ${count(d.not_emailed, 'pledger')} to subscribe`} doing="Sending..."
          confirm={`Email ${count(d.not_emailed, 'person', 'people')} who pledged a link to start their subscription? Each gets it once.`} yes="Send"
          run={() => run('email_pledgers')} done={(r) => { pl.reload(); return r?.message || 'Sending.'; }} />
      )}
      {d.pledges?.length > 0 && (
        <Rows>
          {d.pledges.slice(0, 50).map((x: any) => (
            <Row key={x.email} title={x.email} meta={[x.name, `${x.plan === 'annual' ? 'Yearly' : x.plan === 'founding' ? 'Founding' : 'Monthly'} ${money(x.amount, x.currency)}`, day(x.pledged_at), x.emailed_at ? 'invited' : null].filter(Boolean).join(' · ')} />
          ))}
        </Rows>
      )}
      {!d.count && !connected && s.enabled && <Empty>No pledges yet. The pledge form is on your subscribe page.</Empty>}
    </Section>
  );
}

export function EmailOffer({ offer, onClose }: { offer: any; onClose: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [tier, setTier] = useState('free');
  const [check, setCheck] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const args = { offer_id: offer.id, subject: subject.trim(), body: body.trim(), tier };
  const go = async (dry: boolean) => {
    setBusy(true);
    try {
      const r = await run('email_offer', { ...args, ...(dry ? { dry_run: true } : {}) });
      if (dry) setCheck(r); else { showToast(r?.message || 'Sending.', 'info'); onClose(); }
    } catch (err: any) { if (dry) setCheck({ can_send: false, message: err?.message }); else showToast(err?.message || 'Not sent.', 'error', 8000); }
    finally { setBusy(false); }
  };
  return (
    <Dialog title={`Email "${offer.name || offer.description}"`} onClose={onClose}
      footer={check?.can_send
        ? <Btn kind="primary" disabled={busy} onClick={() => void go(false)}>{busy ? 'Sending...' : `Send to ${count(check.recipients, 'person', 'people')}`}</Btn>
        : <Btn kind="primary" disabled={busy || !subject.trim() || !body.trim()} onClick={() => void go(true)}>{busy ? 'Counting...' : 'Check who gets it'}</Btn>}>
      <p className="ows-sub">The offer's link is added to the end of your message.</p>
      <Field label="To">
        <select className="ows-input" value={tier} onChange={(e) => { setTier(e.target.value); setCheck(null); }}>
          <option value="free">Free subscribers</option><option value="paid">Paid subscribers</option><option value="comp">Complimentary subscribers</option>
        </select>
      </Field>
      <Field label="Subject"><input className="ows-input" value={subject} onChange={(e) => { setSubject(e.target.value); setCheck(null); }} /></Field>
      <Field label="Message"><textarea className="ows-input" rows={6} value={body} onChange={(e) => { setBody(e.target.value); setCheck(null); }} /></Field>
      {check && <Notice kind={check.can_send ? 'info' : 'warn'}>{check.message}</Notice>}
    </Dialog>
  );
}
