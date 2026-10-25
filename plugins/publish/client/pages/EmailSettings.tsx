/**
 * Settings > Emails: who emails come from and where replies go, the sending domain, the header,
 * footer and banner on post emails (for everyone, or different for paid readers), which
 * subscriber news reaches the writer, and the welcome emails.
 */
import { useState } from 'react';
import { day, run, useSiteKey } from '../api';
import { useSite } from '../SiteApp';
import { ActionBtn, Field, Notice, Section, Toggle } from '../ui';
import { showToast } from '../toast';

type Part = 'email_header' | 'email_footer' | 'email_banner';
const WELCOME = [
  ['welcome_email', 'Free subscribers'],
  ['welcome_email_paid', 'Paid and complimentary subscribers'],
  ['welcome_email_founding', 'Founding members'],
  ['welcome_email_imported', 'Imported subscribers'],
] as const;
const NOTICES = [
  ['notify_free_subscribers', 'New free subscribers'],
  ['notify_paid_subscribers', 'New paid subscribers'],
  ['notify_cancellations', 'Cancellations'],
] as const;
const DOMAIN_STATUS: Record<string, string> = {
  ready: 'Ready: emails go out from your domain.',
  waiting_for_dns: 'Waiting for the DNS records below.',
  waiting_for_sender_verification: 'Waiting for you to click the verification email sent to that address.',
};

function SendingDomain() {
  const { info, refresh } = useSite();
  const key = useSiteKey();
  const d = info.sender?.sending_domain;
  const [domain, setDomain] = useState('');
  const [fromEmail, setFromEmail] = useState('');
  const [records, setRecords] = useState<any[] | null>(null);
  if (d) {
    return (
      <Section title="Sending domain">
        <p className="ows-sub">{d.from_name ? `${d.from_name} ` : ''}&lt;{d.from_email}&gt; · {DOMAIN_STATUS[d.status] || d.status}</p>
        {d.status !== 'ready' && (
          <ActionBtn label="Check now" doing="Checking..." run={() => run('check_sending_domain')}
            done={() => { refresh(); return 'Checked.'; }} />
        )}
      </Section>
    );
  }
  return (
    <Section title="Send from your own domain">
      <p className="ows-sub">Emails now come from {info.sender?.from_email || 'an openwriter.io address'}. Sending from your own domain (like newsletter@yourname.com) looks more personal and lands in inboxes more reliably.</p>
      {key ? <Notice>Switch to this site's own profile in OpenWriter to set up its sending domain.</Notice> : (
        <>
          <div className="ows-grid2">
            <Field label="Domain"><input className="ows-input" placeholder="yourname.com" value={domain} onChange={(e) => setDomain(e.target.value.trim().toLowerCase())} /></Field>
            <Field label="From address"><input className="ows-input" placeholder="newsletter@yourname.com" value={fromEmail} onChange={(e) => setFromEmail(e.target.value.trim())} /></Field>
          </div>
          <ActionBtn kind="primary" label="Set up" doing="Setting up..." disabled={!domain.includes('.') || !fromEmail.includes('@')}
            run={async () => { const r = await run<{ dnsRecords?: any[]; next_action?: string }>('set_sending_domain', { domain, from_email: fromEmail }); setRecords(r.dnsRecords || []); return r; }}
            done={(r) => { refresh(); return r?.next_action || 'Started. Add the DNS records where you bought the domain.'; }} />
          {records && records.length > 0 && (
            <div className="ows-table-wrap">
              <table className="ows-table">
                <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
                <tbody>{records.map((r, i) => <tr key={i}><td>{r.type}</td><td className="ows-mono">{r.host || r.name}</td><td className="ows-mono">{r.data || r.value}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function PartFields({ part, label, kind, value, onChange }: {
  part: Part; label: string; kind: 'text' | 'image';
  value: { free: string; paid: string; split: boolean }; onChange: (v: { free: string; paid: string; split: boolean }) => void;
}) {
  const input = (who: 'free' | 'paid', title: string) => kind === 'text'
    ? <Field key={who} label={title}><textarea className="ows-input" rows={2} maxLength={2000} value={value[who]} onChange={(e) => onChange({ ...value, [who]: e.target.value, ...(value.split ? {} : { paid: e.target.value }) })} /></Field>
    : (
      <div className="ows-field" key={who}>
        <span className="ows-field-label">{title}</span>
        {value[who] && <div className="ows-pic-row"><img className="ows-pic" src={value[who]} alt="" /></div>}
        <input className="ows-input" placeholder="https://..." value={value[who]} onChange={(e) => onChange({ ...value, [who]: e.target.value.trim(), ...(value.split ? {} : { paid: e.target.value.trim() }) })} />
        <span className="ows-field-hint">The address of a picture on the web (https), 600 pixels wide works best.</span>
      </div>
    );
  return (
    <div className="ows-subsection" data-part={part}>
      {value.split ? <>{input('free', `${label} for free readers`)}{input('paid', `${label} for paid readers`)}</> : input('free', label)}
      <Toggle label={`Different ${label.toLowerCase()} for paid readers`} checked={value.split} onChange={(v) => onChange({ ...value, split: v, paid: v ? value.paid : value.free })} />
    </div>
  );
}

export default function EmailSettings() {
  const { info, refresh } = useSite();
  const st = info.site?.settings || {};
  const sender = info.sender || {};
  const load = (p: Part) => {
    const v = st[p] || { free: null, paid: null };
    return { free: v.free || '', paid: v.paid || '', split: (v.free || '') !== (v.paid || '') };
  };
  const [parts, setParts] = useState<Record<Part, { free: string; paid: string; split: boolean }>>({
    email_header: load('email_header'), email_footer: load('email_footer'), email_banner: load('email_banner'),
  });
  const [replyTo, setReplyTo] = useState<string>(sender.reply_to_is_default ? '' : sender.reply_to || '');
  const [welcome, setWelcome] = useState<Record<string, string>>(Object.fromEntries(WELCOME.map(([k]) => [k, st[k] ?? ''])));
  const notice = async (key: string, v: string) => {
    try { await run('update_site_settings', { [key]: v }); refresh(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
  };
  const partArgs = () => Object.fromEntries((Object.keys(parts) as Part[]).flatMap((p) => parts[p].split
    ? [[`${p}_free`, parts[p].free], [`${p}_paid`, parts[p].paid]]
    : [[p, parts[p].free]]));
  const s = info.sending;

  return (
    <>
      <Section title="Sending">
        {s.status === 'review' && <Notice kind="warn">Your site can email {s.daily_cap} people a day while we review it.{s.review_requested_at ? ` You asked for review on ${day(s.review_requested_at)}.` : ' Ask for review on Home.'}</Notice>}
        {s.status === 'active' && <p className="ows-sub">Your site can email all your subscribers.</p>}
        {s.status === 'suspended' && <Notice kind="error">Sending is paused for this site.</Notice>}
        {sender.from_email && <p className="ows-sub">Emails come from {sender.from_name ? `${sender.from_name} ` : ''}&lt;{sender.from_email}&gt;.</p>}
        <Field label="Replies go to" hint={`Readers who reply to your emails reach this address. Empty: your account email${sender.reply_to_is_default && sender.reply_to ? ` (${sender.reply_to})` : ''}.`}>
          <input className="ows-input" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value.trim())} />
        </Field>
        <ActionBtn label="Save reply address" doing="Saving..." run={() => run('update_site_settings', { reply_to: replyTo })}
          done={() => { refresh(); return replyTo ? `Replies now go to ${replyTo}.` : 'Replies go to your account email.'; }} />
      </Section>

      <SendingDomain />

      <Section title="Around every post email">
        <p className="ows-sub">Shown only in emails, not on your site. Simple markdown works: **bold**, *italic*, [a link](https://...).</p>
        <PartFields part="email_banner" label="Banner" kind="image" value={parts.email_banner} onChange={(v) => setParts({ ...parts, email_banner: v })} />
        <PartFields part="email_header" label="Header" kind="text" value={parts.email_header} onChange={(v) => setParts({ ...parts, email_header: v })} />
        <PartFields part="email_footer" label="Footer" kind="text" value={parts.email_footer} onChange={(v) => setParts({ ...parts, email_footer: v })} />
        <ActionBtn kind="primary" label="Save" doing="Saving..." run={() => run('update_site_settings', partArgs())}
          done={() => { refresh(); return 'Saved. The next post email carries them.'; }} />
      </Section>

      <Section title="Tell me about">
        {NOTICES.map(([k, label]) => (
          <Field key={k} label={label}>
            <select className="ows-input ows-select-sm" value={st[k] || 'off'} onChange={(e) => void notice(k, e.target.value)}>
              <option value="each">An email for each one</option>
              <option value="digest">One email a day</option>
              <option value="off">Nothing</option>
            </select>
          </Field>
        ))}
      </Section>

      <Section title="Welcome emails">
        <p className="ows-sub">Sent once when someone joins. Leave one empty to use the standard welcome.</p>
        {WELCOME.map(([k, label]) => (
          <Field key={k} label={label}><textarea className="ows-input" rows={4} value={welcome[k]} onChange={(e) => setWelcome({ ...welcome, [k]: e.target.value })} /></Field>
        ))}
        <ActionBtn kind="primary" label="Save welcome emails" doing="Saving..."
          run={() => run('update_site_settings', Object.fromEntries(WELCOME.filter(([k]) => (welcome[k] ?? '') !== (st[k] ?? '')).map(([k]) => [k, welcome[k]])))}
          done={() => { refresh(); return 'Saved the welcome emails.'; }} />
      </Section>
    </>
  );
}
