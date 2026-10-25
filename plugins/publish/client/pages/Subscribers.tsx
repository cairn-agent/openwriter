/**
 * Subscribers: how many of each kind, the list (filter by kind, search by email or name), one
 * subscriber's page (plan, payments, activity, and support: refund, cancel, renewal, founding),
 * add one, import a CSV, export the list, and requests to join a private site.
 */
import { useEffect, useState } from 'react';
import { count, day, money, run, useTool } from '../api';
import { go, useNav } from '../nav';
import { useSite } from '../SiteApp';
import { EmailComposer, SentMessages } from '../EmailComposer';
import { Cleanup, MemberTags, SaveSegment, SegmentPicker } from '../Segments';
import { ActionBtn, Btn, Empty, Failed, Field, Loading, Notice, Page, Row, Rows, Section, Stat, Stats, Tabs, Toggle } from '../ui';
import { showToast } from '../toast';

const TIER_LABEL: Record<string, string> = { free: 'Free', paid: 'Paid', founding: 'Founding', comp: 'Complimentary' };
const STATUS_LABEL: Record<string, string> = { active: 'Subscribed', pending: 'Waiting to confirm', unsubscribed: 'Unsubscribed', bounced: 'Email bounced', complained: 'Marked as spam' };

type Tier = 'all' | 'free' | 'paid' | 'founding' | 'comp';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function AddOne({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [welcome, setWelcome] = useState(true);
  return (
    <Section title="Add a subscriber">
      <div className="ows-grid2">
        <Field label="Email"><input className="ows-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Name (optional)"><input className="ows-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      </div>
      <Toggle label="Send them the welcome email" checked={welcome} onChange={setWelcome} hint="Only someone who agreed to hear from you should be added." />
      <ActionBtn kind="primary" label="Add subscriber" doing="Adding..." disabled={!email.includes('@')}
        run={() => run('add_subscriber', { email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}), send_welcome: welcome })}
        done={(r) => { setEmail(''); setName(''); onDone(); return r?.message || 'Added.'; }} />
    </Section>
  );
}

function Import({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState('');
  const [file, setFile] = useState('');
  const rows = csv ? Math.max(csv.split(/\r?\n/).filter((l) => l.trim()).length - 1, 0) : 0;
  return (
    <Section title="Import subscribers">
      <p className="ows-sub">A CSV from Substack, Mailchimp, ConvertKit, Beehiiv or any list with an email column. Imported people get no confirmation email, and anyone who unsubscribed is skipped.</p>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f.name);
        setCsv(await f.text());
      }} />
      {file && <p className="ows-sub">{file}: about {count(rows, 'row')}.</p>}
      <ActionBtn kind="primary" label={rows ? `Import ${count(rows, 'subscriber')}` : 'Import'} doing="Importing..." disabled={!rows}
        confirm={`Import ${count(rows, 'person', 'people')} from ${file}? They start getting your posts.`} yes="Import"
        run={() => run('import_subscribers', { csv_text: csv })}
        done={(r) => { setCsv(''); setFile(''); onDone(); return r?.message || 'Imported.'; }} />
    </Section>
  );
}

function Requests() {
  const req = useTool<{ requests?: any[] }>('list_subscribe_requests', { status: 'pending' });
  const list = req.data?.requests || [];
  if (req.loading || !list.length) return null;
  return (
    <Section title={`Asking to subscribe (${list.length})`}>
      <Rows>
        {list.map((r) => (
          <Row key={r.id} title={r.email} meta={[r.name, day(r.created_at)].filter(Boolean).join(' · ')}
            actions={<>
              <ActionBtn kind="primary" label="Approve" doing="Approving..." run={() => run('decide_subscribe_request', { request_id: r.id, decision: 'approve' })}
                done={() => { req.reload(); return `Approved ${r.email}. They get the welcome email.`; }} />
              <ActionBtn kind="quiet" label="Deny" doing="Denying..." run={() => run('decide_subscribe_request', { request_id: r.id, decision: 'deny' })}
                done={() => { req.reload(); return `Denied ${r.email}. They are sent nothing.`; }} />
            </>} />
        ))}
      </Rows>
    </Section>
  );
}

function Member({ id }: { id: string }) {
  const { info } = useSite();
  const m = useTool<{ member: any; stripe_error?: string }>('get_subscriber', { member_id: id });
  if (m.loading && !m.data) return <Page title="Subscriber"><Loading what="the subscriber" /></Page>;
  if (m.error || !m.data) return <Page title="Subscriber"><Failed error={m.error || 'Not found.'} retry={m.reload} /></Page>;
  const s = m.data.member;
  const p = s.plan;
  const a = s.activity || {};
  const done = (r: any) => { m.reload(); return r?.message || 'Done.'; };
  const owner = info.role === 'owner' || info.role === 'admin';
  return (
    <Page title={s.name || s.email} sub={<>{s.name ? `${s.email} · ` : ''}{TIER_LABEL[s.tier] || s.tier} · {STATUS_LABEL[s.status] || s.status} · since {day(s.subscribed_at)}</>}
      actions={<Btn kind="quiet" onClick={() => go('subscribers')}>All subscribers</Btn>}>
      {m.data.stripe_error && <Notice kind="warn">{m.data.stripe_error}</Notice>}
      <Stats>
        <Stat label="Emails received" value={(a.emails_received ?? 0).toLocaleString()} />
        <Stat label="Opened" value={(a.opens ?? 0).toLocaleString()} />
        <Stat label="Clicked" value={(a.clicks ?? 0).toLocaleString()} />
        <Stat label="Comments" value={(a.comments ?? 0).toLocaleString()} sub={a.last_seen ? `Last seen ${day(a.last_seen)}` : undefined} />
      </Stats>
      <Section title="Plan">
        {!p && <p className="ows-sub">{s.comp ? `Complimentary ${s.comp.tier === 'founding' ? 'founding ' : ''}access${s.comp.expires_at ? ` until ${day(s.comp.expires_at)}` : ''}.` : s.group ? 'A seat on a group plan.' : 'No paid plan.'}</p>}
        {p && (
          <>
            <p className="ows-sub">
              {p.name || 'Paid'}, {money(p.amount, p.currency)} a {p.interval === 'year' ? 'year' : 'month'}
              {p.trial_end && new Date(p.trial_end) > new Date() ? ` · free trial until ${day(p.trial_end)}` : ''}
              {p.cancel_at_period_end ? ` · ends ${day(p.current_period_end)}, will not renew` : p.current_period_end ? ` · renews ${day(p.current_period_end)}` : ''}
              {s.founding ? ' · Founding member' : ''}
              {s.billing_paused ? ` · billing paused${s.billing_paused.resume_at ? ` until ${day(s.billing_paused.resume_at)}` : ''}${s.billing_paused.site_wide ? ' (the whole site is paused)' : ''}` : ''}
            </p>
            {owner && (
              <div className="ows-actions">
                <ActionBtn label={p.cancel_at_period_end ? 'Turn renewal back on' : 'Stop renewal'} doing="Saving..."
                  confirm={p.cancel_at_period_end ? undefined : `Stop renewal for ${s.email}? They keep access until ${day(p.current_period_end)}, then the plan ends.`} yes="Stop renewal"
                  run={() => run('set_auto_renew', { member_id: id, auto_renew: !!p.cancel_at_period_end })} done={done} />
                <ActionBtn label={s.billing_paused ? 'Resume their billing' : 'Pause their billing'} doing="Saving..."
                  confirm={s.billing_paused ? undefined : `Pause billing for ${s.email}? They keep access and are not charged until you resume it.`} yes="Pause"
                  run={() => run('pause_subscriber_billing', { member_id: id, paused: !s.billing_paused })} done={done} />
                <ActionBtn kind="danger" label="Cancel now" doing="Cancelling..."
                  confirm={`Cancel ${s.email}'s plan now? Their paid access ends at once and no refund is made unless you refund a payment below.`} yes="Cancel now"
                  run={() => run('cancel_subscription', { member_id: id, when: 'now' })} done={done} />
                {s.founding_via !== 'plan' && (
                  <ActionBtn label={s.founding ? 'Remove founding mark' : 'Mark as founding member'} doing="Saving..."
                    run={() => run('set_founding', { member_id: id, founding: !s.founding })} done={done} />
                )}
              </div>
            )}
          </>
        )}
      </Section>
      {Array.isArray(s.payments) && s.payments.length > 0 && (
        <Section title="Payments">
          <Rows>
            {s.payments.map((pay: any) => {
              const left = pay.amount - (pay.refunded_amount || 0);
              return (
                <Row key={pay.id} title={money(pay.amount, pay.currency)}
                  meta={[day(pay.date), pay.status === 'succeeded' ? null : pay.status, pay.refunded_amount ? `${money(pay.refunded_amount, pay.currency)} refunded` : null].filter(Boolean).join(' · ')}
                  actions={<>
                    {pay.invoice_url && <a className="ows-btn ows-btn--quiet" href={pay.invoice_url} target="_blank" rel="noopener noreferrer">Receipt</a>}
                    {owner && pay.status === 'succeeded' && left > 0 && (
                      <ActionBtn kind="danger" label="Refund" doing="Refunding..."
                        confirm={`Refund ${money(left, pay.currency)} to ${s.email}? Their plan is not changed.`} yes="Refund"
                        run={() => run('refund_subscriber', { member_id: id, payment_id: pay.id })} done={done} />
                    )}
                  </>} />
              );
            })}
          </Rows>
        </Section>
      )}
      <MemberTags id={id} tags={s.tags || []} onChange={m.reload} />
      {owner && s.status === 'active' && (
        <Section title="Email">
          <Toggle label="Gets new posts by email" checked={!s.email_off}
            hint={s.email_off
              ? `Emails are off${s.email_off_at ? ` since ${day(s.email_off_at)}` : ''}. They stay subscribed and keep their access; they read new posts on the site.`
              : 'Turning this off stops every post and message email. They stay subscribed and keep their access.'}
            onChange={async (v) => {
              try { const r = await run('set_subscriber_emails', { member_id: id, email_off: !v }); m.reload(); showToast(r?.message || 'Saved.', 'info'); }
              catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
            }} />
        </Section>
      )}
      {owner && s.status === 'active' && !s.email_off && <EmailComposer to={s.name || s.email} target={{ member_id: id }} />}
      {owner && s.status === 'active' && (
        <Section title="Remove">
          <div className="ows-actions">
            <ActionBtn kind="danger" label="Unsubscribe" doing="Unsubscribing..."
              confirm={`Unsubscribe ${s.email}? They leave your list. To stop emails but keep them subscribed, turn emails off above instead. A paid plan is not cancelled by this.`} yes="Unsubscribe"
              run={() => run('remove_subscriber', { id })} done={(r) => { m.reload(); return `Unsubscribed ${s.email}.`; }} />
            <ActionBtn kind="danger" label="Ban from the site" doing="Banning..."
              confirm={`Ban ${s.email}? They are unsubscribed and cannot subscribe, comment or like again. Paid access is kept until you cancel it.`} yes="Ban"
              run={() => run('ban_readers', { emails: [s.email] })} done={(r) => { m.reload(); return r?.note || `Banned ${s.email}.`; }} />
          </div>
        </Section>
      )}
    </Page>
  );
}

export default function Subscribers() {
  const nav = useNav();
  const { info } = useSite();
  const [tier, setTier] = useState<Tier>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<'none' | 'add' | 'import' | 'email' | 'cleanup'>('none');
  const [section, setSection] = useState('');
  const [tag, setTag] = useState('');
  const [segment, setSegment] = useState('');
  const [segTick, setSegTick] = useState(0);
  const [emails, setEmails] = useState<'' | 'on' | 'off'>('');
  const PER = 100;

  useEffect(() => { const t = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(t); }, [query]);
  useEffect(() => { setPage(0); }, [tier, search, status, section, tag, segment, emails]);

  const counts = useTool<{ active_by_tier?: Record<string, number>; email_off?: number }>('get_subscriber_counts');
  const sections = useTool<{ sections: any[] }>('list_site_sections');
  const tags = useTool<{ tags: any[] }>('list_subscriber_tags');
  // A saved segment is the whole filter; it never mixes with the others.
  const filter = segment ? { segment } : { ...(tier !== 'all' ? { tier } : {}), ...(section ? { section } : {}), ...(tag ? { tag } : {}), ...(emails ? { email_off: emails === 'off' } : {}), ...(search ? { search } : {}) };
  const args = { limit: PER, offset: page * PER, status, ...filter };
  const list = useTool<{ count: number; subscribers: any[] }>('list_subscribers', args);

  if (nav.item) return <Member id={nav.item} />;

  const t = counts.data?.active_by_tier || {};
  const total = Object.values(t).reduce((a, b) => a + (b || 0), 0);
  const reload = () => { list.reload(); counts.reload(); };

  return (
    <Page title="Subscribers" actions={<>
      <Btn kind="primary" onClick={() => setPanel(panel === 'email' ? 'none' : 'email')}>Email subscribers</Btn>
      <Btn onClick={() => setPanel(panel === 'add' ? 'none' : 'add')}>Add</Btn>
      <Btn onClick={() => setPanel(panel === 'import' ? 'none' : 'import')}>Import</Btn>
      <Btn onClick={() => setPanel(panel === 'cleanup' ? 'none' : 'cleanup')}>Clean up</Btn>
      <ActionBtn label="Export CSV" doing="Exporting..."
        run={async () => {
          const r = await run<{ csv: string; rows: number }>('export_subscribers', { status, ...filter });
          download(`${info.site?.slug || 'subscribers'}-subscribers.csv`, r.csv);
          return r;
        }}
        done={(r) => `Downloaded ${count(r?.rows, 'subscriber')}.`} />
    </>}>
      <Stats>
        <Stat label="Subscribers" value={total.toLocaleString()} sub={counts.data?.email_off ? `${counts.data.email_off.toLocaleString()} with emails off` : undefined} />
        <Stat label="Free" value={(t.free || 0).toLocaleString()} />
        <Stat label="Paid" value={((t.paid || 0) + (t.founding || 0)).toLocaleString()} sub={t.founding ? `${t.founding} founding` : undefined} />
        <Stat label="Complimentary" value={(t.comp || 0).toLocaleString()} />
      </Stats>
      {panel === 'add' && <AddOne onDone={reload} />}
      {panel === 'import' && <Import onDone={reload} />}
      {panel === 'cleanup' && <Cleanup onDone={reload} />}
      {panel === 'email' && (
        <>
          <EmailComposer to={Object.keys(filter).length ? 'the subscribers shown below' : 'all subscribers'} target={filter} />
          <SentMessages />
        </>
      )}
      <Requests />
      <div className="ows-filters">
        <Tabs label="Kind" value={tier} onChange={setTier} options={[
          { value: 'all', label: 'All' }, { value: 'free', label: 'Free' }, { value: 'paid', label: 'Paid' },
          { value: 'founding', label: 'Founding' }, { value: 'comp', label: 'Complimentary' },
        ]} />
        <input className="ows-input ows-search" type="search" placeholder="Search by email or name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search subscribers" />
        <SegmentPicker key={segTick} value={segment} onChange={setSegment} />
        {!segment && (tags.data?.tags?.length ?? 0) > 0 && (
          <select className="ows-input ows-select-sm" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
            <option value="">Any tag</option>
            {tags.data!.tags.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.active})</option>)}
          </select>
        )}
        {!segment && (sections.data?.sections?.length ?? 0) > 0 && (
          <select className="ows-input ows-select-sm" value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section">
            <option value="">Every section</option>
            {sections.data!.sections.map((x) => <option key={x.id} value={x.id}>Gets {x.name}{x.subscribers !== undefined ? ` (${x.subscribers})` : ''}</option>)}
          </select>
        )}
        {!segment && (
          <select className="ows-input ows-select-sm" value={emails} onChange={(e) => setEmails(e.target.value as '' | 'on' | 'off')} aria-label="Emails">
            <option value="">Emails on or off</option>
            <option value="on">Gets emails</option>
            <option value="off">Emails off</option>
          </select>
        )}
        <select className="ows-input ows-select-sm" value={status} onChange={(e) => setStatus(e.target.value as 'active' | 'all')} aria-label="Status">
          <option value="active">Subscribed now</option>
          <option value="all">Everyone, including unsubscribed</option>
        </select>
        {!segment && <SaveSegment filter={filter} onSaved={() => setSegTick((n) => n + 1)} />}
      </div>
      {list.loading && !list.data && <Loading what="subscribers" />}
      {list.error && <Failed error={list.error} retry={list.reload} />}
      {list.data && list.data.subscribers.length === 0 && (
        <Empty>{Object.keys(filter).length ? 'Nobody matches.' : 'No subscribers yet. Share your site, add people who asked to hear from you, or import a list.'}</Empty>
      )}
      {list.data && list.data.subscribers.length > 0 && (
        <>
          <p className="ows-sub">{count(list.data.count, 'subscriber')}{Object.keys(filter).length ? ' match' : ''}</p>
          <Rows>
            {list.data.subscribers.map((s) => (
              <Row key={s.id} title={s.email} onOpen={() => go('subscribers', s.id)}
                meta={[s.name, TIER_LABEL[s.tier] || s.tier, s.tags?.length ? s.tags.join(', ') : null, s.status !== 'active' ? STATUS_LABEL[s.status] || s.status : null, s.email_off ? 'emails off' : null, `since ${day(s.subscribedAt)}`].filter(Boolean).join(' · ')} />
            ))}
          </Rows>
          {list.data.count > PER && (
            <div className="ows-actions">
              <Btn disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Btn>
              <span className="ows-sub">{page * PER + 1} to {Math.min((page + 1) * PER, list.data.count)} of {list.data.count.toLocaleString()}</span>
              <Btn disabled={(page + 1) * PER >= list.data.count} onClick={() => setPage(page + 1)}>Next</Btn>
            </div>
          )}
        </>
      )}
    </Page>
  );
}
