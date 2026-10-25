/**
 * Money: connect Stripe, set the paid plans, give complimentary access, make offer links, and
 * gift and group subscriptions. Prices are typed in the currency, sent in cents.
 */
import { useEffect, useState } from 'react';
import { count, day, money, run, useTool } from '../api';
import { ActionBtn, Btn, Empty, Failed, Field, Loading, Notice, Page, Row, Rows, Section, Tabs, Toggle } from '../ui';
import { showToast } from '../toast';
import { EmailOffer, PauseBilling, Pledges } from '../MoneyExtras';
import { Perks } from '../GrowthExtras';

type View = 'plans' | 'comps' | 'offers' | 'gifts' | 'perks';

const toCents = (v: string): number => Math.round(parseFloat(v || '0') * 100);
const fromCents = (c: number | undefined): string => (c ? (c / 100).toFixed(2).replace(/\.00$/, '') : '');

function Stripe({ p, reload }: { p: any; reload: () => void }) {
  const [opened, setOpened] = useState(false);
  if (!p.stripe_connected) {
    return (
      <Section title="Get paid">
        <p className="ows-sub">Readers pay through Stripe, straight into your own Stripe account. OpenWriter keeps 5%; Stripe charges its own card fee.</p>
        <div className="ows-actions">
          <ActionBtn kind="primary" label="Connect Stripe" doing="Opening Stripe..."
            run={async () => { const r = await run<{ url: string }>('connect_stripe'); window.open(r.url, '_blank', 'noopener'); setOpened(true); return r; }}
            done={() => 'Finish in the Stripe tab, then come back here.'} />
          {opened && <Btn onClick={reload}>I finished in Stripe</Btn>}
        </div>
      </Section>
    );
  }
  return (
    <Section title="Stripe" aside={
      <ActionBtn kind="danger" label="Disconnect" doing="Disconnecting..."
        confirm="Disconnect Stripe? New paid signups stop at once. Current subscribers keep paying on your Stripe; manage them there." yes="Disconnect"
        run={() => run('disconnect_stripe', { confirm: true })} done={(r) => { reload(); return r?.note || 'Disconnected.'; }} />
    }>
      <p className="ows-sub">Connected{p.connected_at ? ` since ${day(p.connected_at)}` : ''}. {p.livemode === false ? 'This is a Stripe test account: nobody is charged for real.' : 'Payments go to your Stripe account.'}</p>
    </Section>
  );
}

function Plans({ p, reload }: { p: any; reload: () => void }) {
  const byPlan = (name: string) => (p.plans || []).find((x: any) => x.plan === name) || {};
  const [currency, setCurrency] = useState<string>(p.plans?.[0]?.currency || 'usd');
  const [monthly, setMonthly] = useState(fromCents(byPlan('monthly').amount));
  const [annual, setAnnual] = useState(fromCents(byPlan('annual').amount));
  const [founding, setFounding] = useState(fromCents(byPlan('founding').amount));
  const [benefits, setBenefits] = useState<Record<string, string>>({
    monthly: byPlan('monthly').benefits?.join?.('\n') ?? byPlan('monthly').benefits ?? '',
    annual: byPlan('annual').benefits?.join?.('\n') ?? byPlan('annual').benefits ?? '',
    founding: byPlan('founding').benefits?.join?.('\n') ?? byPlan('founding').benefits ?? '',
  });
  const [trial, setTrial] = useState<boolean>(!!p.trial_7_day);
  const plan = (amount: string, name: string) => ({ amount: toCents(amount), ...(benefits[name]?.trim() ? { benefits: benefits[name].trim() } : {}) });
  const ok = toCents(monthly) >= 500 && toCents(annual) >= 3000 && (!founding || toCents(founding) > toCents(annual));
  if (!p.stripe_connected) return null;
  return (
    <Section title="Plans">
      <p className="ows-sub">A new price applies to new subscribers; people already paying keep their price.</p>
      <Field label="Currency">
        <select className="ows-input ows-select-sm" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {['usd', 'eur', 'gbp', 'cad', 'aud'].map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
        </select>
      </Field>
      <div className="ows-grid3">
        <Field label="Monthly" hint="At least 5"><input className="ows-input" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} /></Field>
        <Field label="Yearly" hint="At least 30"><input className="ows-input" inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} /></Field>
        <Field label="Founding member, yearly" hint="Optional; more than yearly"><input className="ows-input" inputMode="decimal" value={founding} onChange={(e) => setFounding(e.target.value)} /></Field>
      </div>
      {(['monthly', 'annual', 'founding'] as const).filter((k) => k !== 'founding' || founding).map((k) => (
        <Field key={k} label={`What ${k === 'annual' ? 'yearly' : k} subscribers get`}>
          <textarea className="ows-input" rows={2} value={benefits[k]} onChange={(e) => setBenefits({ ...benefits, [k]: e.target.value })} />
        </Field>
      ))}
      <Toggle label="7 days free for new subscribers" hint="Once per reader." checked={trial} onChange={setTrial} />
      <ActionBtn kind="primary" label="Save plans" doing="Saving..." disabled={!ok}
        run={() => run('set_site_plans', {
          currency, trial_7_day: trial, monthly: plan(monthly, 'monthly'), annual: plan(annual, 'annual'),
          ...(founding ? { founding: plan(founding, 'founding') } : {}),
        })}
        done={() => { reload(); return `Saved: ${money(toCents(monthly), currency)} a month, ${money(toCents(annual), currency)} a year${founding ? `, founding ${money(toCents(founding), currency)}` : ''}.`; }} />
    </Section>
  );
}

const DURATIONS = [['7d', '7 days'], ['30d', '30 days'], ['90d', '90 days'], ['6mo', '6 months'], ['1yr', '1 year'], ['forever', 'Forever']];

function Comps() {
  const comps = useTool<{ comps: any[] }>('list_comps');
  const [email, setEmail] = useState('');
  const [duration, setDuration] = useState('1yr');
  const [founding, setFounding] = useState(false);
  return (
    <>
      <Section title="Give complimentary access">
        <p className="ows-sub">Paid access without paying: for a friend, a reviewer, or someone who asked.</p>
        <div className="ows-grid2">
          <Field label="Email"><input className="ows-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="For">
            <select className="ows-input" value={duration} onChange={(e) => setDuration(e.target.value)}>
              {DURATIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <Toggle label="As a founding member" checked={founding} onChange={setFounding} />
        <ActionBtn kind="primary" label="Give access" doing="Saving..." disabled={!email.includes('@')}
          run={() => run('grant_comp', { email: email.trim(), duration, founding })}
          done={(r) => { setEmail(''); comps.reload(); return r?.message || `${email.trim()} has complimentary access.`; }} />
      </Section>
      <Section title="Complimentary">
        {comps.loading && !comps.data && <Loading what="complimentary access" />}
        {comps.error && <Failed error={comps.error} retry={comps.reload} />}
        {comps.data && !comps.data.comps.length && <Empty>Nobody has complimentary access.</Empty>}
        {comps.data && comps.data.comps.length > 0 && (
          <Rows>
            {comps.data.comps.map((c) => (
              <Row key={c.id} title={c.email}
                meta={[c.name, c.comp_tier === 'founding' ? 'Founding' : 'Paid', c.gift ? 'Gift' : null, c.comp_expires_at ? `until ${day(c.comp_expires_at)}` : 'forever'].filter(Boolean).join(' · ')}
                actions={<ActionBtn kind="quiet" label="End" doing="Ending..." confirm={`End ${c.email}'s complimentary access now? They go back to what they pay for, or to free.`} yes="End it"
                  run={() => run('end_comp', { membership_id: c.id })} done={() => { comps.reload(); return `Ended ${c.email}'s complimentary access.`; }} />} />
            ))}
          </Rows>
        )}
      </Section>
    </>
  );
}

function Offers() {
  const offers = useTool<{ offers: any[] }>('list_offers');
  const [emailing, setEmailing] = useState<any | null>(null);
  const [kind, setKind] = useState<'discount' | 'trial'>('discount');
  const [percent, setPercent] = useState('20');
  const [days, setDays] = useState('30');
  const [duration, setDuration] = useState<'once' | 'repeating' | 'forever'>('once');
  const [months, setMonths] = useState('3');
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('');
  const STATE: Record<string, string> = { live: 'Working', ended: 'Ended', expired: 'Expired', limit_reached: 'Used up', not_available: 'Not available' };
  return (
    <>
      <Section title="Make an offer">
        <p className="ows-sub">A link with a discount or a free trial. Share it anywhere; readers who use it keep the deal.</p>
        <Tabs label="Kind" value={kind} onChange={setKind} options={[{ value: 'discount', label: 'Discount' }, { value: 'trial', label: 'Free trial' }]} />
        {kind === 'discount' ? (
          <div className="ows-grid3">
            <Field label="Percent off"><input className="ows-input" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} /></Field>
            <Field label="For">
              <select className="ows-input" value={duration} onChange={(e) => setDuration(e.target.value as any)}>
                <option value="once">The first payment</option><option value="repeating">Some months</option><option value="forever">Every payment</option>
              </select>
            </Field>
            {duration === 'repeating' && <Field label="Months"><input className="ows-input" inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></Field>}
          </div>
        ) : (
          <Field label="Days free"><input className="ows-input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></Field>
        )}
        <div className="ows-grid2">
          <Field label="Name (optional)" hint="Only you see it"><input className="ows-input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Link stops working (optional)"><input className="ows-input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        </div>
        <ActionBtn kind="primary" label="Make the link" doing="Making..."
          run={() => run('create_offer', {
            kind,
            ...(kind === 'trial' ? { trial_days: Number(days) } : { percent_off: Number(percent), duration, ...(duration === 'repeating' ? { duration_months: Number(months) } : {}) }),
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(expires ? { expires_at: new Date(`${expires}T23:59:59`).toISOString() } : {}),
          })}
          done={(r) => { offers.reload(); const url = r?.offer?.url || r?.url; if (url) void navigator.clipboard?.writeText(url).catch(() => {}); return url ? `Made and copied: ${url}` : 'Made the offer.'; }} />
      </Section>
      <Section title="Offers">
        {offers.loading && !offers.data && <Loading what="offers" />}
        {offers.error && <Failed error={offers.error} retry={offers.reload} />}
        {offers.data && !offers.data.offers.length && <Empty>No offers yet.</Empty>}
        {offers.data && offers.data.offers.length > 0 && (
          <Rows>
            {offers.data.offers.map((o) => (
              <Row key={o.id} title={o.name || o.description} meta={[o.name ? o.description : null, STATE[o.state] || o.state, `used ${count(o.times_redeemed, 'time')}`, o.expires_at ? `until ${day(o.expires_at)}` : null].filter(Boolean).join(' · ')}
                actions={<>
                  {o.url && o.state === 'live' && (
                    <ActionBtn kind="quiet" label="Copy link" doing="Copying..." run={async () => { await navigator.clipboard?.writeText(o.url); }} done={() => 'Link copied.'} />
                  )}
                  {o.state === 'live' && o.url && <button type="button" className="ows-btn ows-btn--quiet" onClick={() => setEmailing(o)}>Email it</button>}
                  {o.state === 'live' && (
                    <ActionBtn kind="quiet" label="End" doing="Ending..." confirm="End this offer? Its link stops working; readers who used it keep their deal." yes="End it"
                      run={() => run('end_offer', { offer_id: o.id })} done={() => { offers.reload(); return 'Offer ended.'; }} />
                  )}
                </>} />
            ))}
          </Rows>
        )}
      </Section>
      {emailing && <EmailOffer offer={emailing} onClose={() => setEmailing(null)} />}
    </>
  );
}

function GiftsAndGroups() {
  const gifts = useTool<{ gifts_enabled: boolean; gifts: any[] }>('get_site_gifts');
  const groups = useTool<{ group_discount_percent: number; groups: any[] }>('get_site_groups');
  const [pct, setPct] = useState('');
  useEffect(() => { if (groups.data) setPct(String(groups.data.group_discount_percent ?? 0)); }, [groups.data]);
  return (
    <>
      <Section title="Gift subscriptions">
        {gifts.error && <Failed error={gifts.error} retry={gifts.reload} />}
        {gifts.data && (
          <>
            <Toggle label="Readers can buy a subscription as a gift" checked={gifts.data.gifts_enabled}
              onChange={async (v) => {
                try { await run('set_site_gifts', { enabled: v }); gifts.reload(); } catch (err: any) { gifts.reload(); showToast(err?.message || 'That did not save.', 'error'); }
              }} />
            {gifts.data.gifts.length > 0 && <p className="ows-sub">{count(gifts.data.gifts.length, 'gift')} bought so far.</p>}
          </>
        )}
      </Section>
      <Section title="Group subscriptions">
        {groups.error && <Failed error={groups.error} retry={groups.reload} />}
        {groups.data && (
          <>
            <p className="ows-sub">Teams and schools buy several yearly seats at once. {count(groups.data.groups.length, 'group')} so far.</p>
            <Field label="Discount on the yearly price for new groups (percent)">
              <input className="ows-input ows-select-sm" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value.replace(/\D/g, ''))} />
            </Field>
            <ActionBtn label="Save discount" doing="Saving..." disabled={pct === '' || Number(pct) > 90}
              run={() => run('set_site_group_discount', { discount_percent: Number(pct) })} done={() => { groups.reload(); return `New groups get ${pct}% off.`; }} />
          </>
        )}
      </Section>
    </>
  );
}

export default function Money() {
  const plans = useTool<any>('get_site_plans');
  const [view, setView] = useState<View>('plans');
  if (plans.loading && !plans.data) return <Page title="Money"><Loading what="payments" /></Page>;
  if (plans.error) return <Page title="Money"><Failed error={plans.error} retry={plans.reload} /></Page>;
  const p = plans.data;
  return (
    <Page title="Money">
      <Stripe p={p} reload={plans.reload} />
      {p.stripe_connected && (
        <>
          <Tabs label="Money" value={view} onChange={setView} options={[
            { value: 'plans', label: 'Plans' }, { value: 'comps', label: 'Complimentary' }, { value: 'offers', label: 'Offers' }, { value: 'gifts', label: 'Gifts and groups' }, { value: 'perks', label: 'Perks' },
          ]} />
          {view === 'plans' && <><Plans p={p} reload={plans.reload} /><PauseBilling p={p} reload={plans.reload} /><Pledges connected /></>}
          {view === 'comps' && <Comps />}
          {view === 'offers' && <Offers />}
          {view === 'gifts' && <GiftsAndGroups />}
          {view === 'perks' && <Perks />}
        </>
      )}
      {!p.stripe_connected && <Notice>Connect Stripe to set prices, offers and gift subscriptions. Complimentary access works without it.</Notice>}
      {!p.stripe_connected && <Pledges connected={false} />}
      {!p.stripe_connected && <Comps />}
    </Page>
  );
}
