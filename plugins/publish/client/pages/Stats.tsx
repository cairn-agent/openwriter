/**
 * Stats: subscribers over time, where readers come from, paid retention (new, cancelled, churn,
 * monthly revenue), the site's totals, and every published post with its rates.
 */
import { useState } from 'react';
import { count, day, money, useTool } from '../api';
import LineChart from '../Chart';
import { Empty, Failed, Loading, Notice, Page, Section, Stat, Stats as Grid, Tabs } from '../ui';

const PLAN_LABEL: Record<string, string> = { monthly: 'Monthly', annual: 'Yearly', founding: 'Founding', gift: 'Gifts', group: 'Group seats' };
const rate = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${v}%`);

function Growth() {
  const [interval, setInterval] = useState<'day' | 'week'>('day');
  const g = useTool<{ points: any[]; note?: string }>('get_subscriber_growth', { interval });
  return (
    <Section title="Subscribers over time" aside={
      <Tabs label="Interval" value={interval} onChange={setInterval} options={[{ value: 'day', label: '30 days' }, { value: 'week', label: '12 weeks' }]} />
    }>
      {g.loading && !g.data && <Loading what="subscriber history" />}
      {g.error && <Failed error={g.error} retry={g.reload} />}
      {g.data && (
        <>
          <LineChart label="Subscribers over time" points={g.data.points} series={[
            { key: 'total', label: 'All', color: 'var(--ink-dark)' },
            { key: 'free', label: 'Free', color: 'var(--accent)' },
            { key: 'paid', label: 'Paid', color: 'var(--ows-green)' },
          ]} />
          {g.data.note && <p className="ows-sub">{g.data.note}</p>}
        </>
      )}
    </Section>
  );
}

function Traffic() {
  const t = useTool<{ views: number; untracked_views: number; channels: any[]; sources: any[] }>('get_traffic_sources');
  if (t.loading && !t.data) return <Section title="Where readers come from"><Loading what="traffic" /></Section>;
  if (t.error) return <Section title="Where readers come from"><Failed error={t.error} retry={t.reload} /></Section>;
  const d = t.data!;
  const total = d.channels.reduce((a, c) => a + (c.views || 0), 0);
  return (
    <Section title="Where readers come from" aside={<span className="ows-sub">last 30 days · {count(d.views, 'view')}</span>}>
      {!total && <Empty>No visits counted yet. Sources are recorded from now on.</Empty>}
      {total > 0 && (
        <div className="ows-bars">
          {d.channels.filter((c) => c.views > 0).map((c) => (
            <div key={c.channel} className="ows-bar">
              <span className="ows-bar-label">{c.label}</span>
              <span className="ows-bar-track"><span className="ows-bar-fill" style={{ width: `${Math.round((c.views / total) * 100)}%` }} /></span>
              <span className="ows-bar-value">{Math.round((c.views / total) * 100)}%</span>
            </div>
          ))}
        </div>
      )}
      {d.sources.length > 0 && (
        <div className="ows-table-wrap">
          <table className="ows-table">
            <thead><tr><th>Source</th><th>Views</th></tr></thead>
            <tbody>{d.sources.slice(0, 10).map((s) => <tr key={`${s.channel}:${s.source}`}><td>{s.source}</td><td>{s.views.toLocaleString()}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {d.untracked_views > 0 && <p className="ows-sub">{count(d.untracked_views, 'earlier view')} came before sources were recorded.</p>}
    </Section>
  );
}

function Retention() {
  const r = useTool<{ currency: string | null; mrr_now: number; paying_now: number; months: any[]; note?: string }>('get_paid_retention', { months: 12 });
  if (r.loading && !r.data) return <Section title="Paid subscribers"><Loading what="retention" /></Section>;
  if (r.error) return <Section title="Paid subscribers"><Failed error={r.error} retry={r.reload} /></Section>;
  const d = r.data!;
  if (!d.paying_now && !d.months.some((m) => m.new_paid || m.cancelled)) return null;
  return (
    <Section title="Paid subscribers" aside={<span className="ows-sub">{count(d.paying_now, 'paying now', 'paying now')} · {money(d.mrr_now, d.currency)} a month</span>}>
      <div className="ows-table-wrap">
        <table className="ows-table">
          <thead><tr><th>Month</th><th>New</th><th>Cancelled</th><th>Churn</th><th>Paying at the end</th><th>Monthly revenue</th></tr></thead>
          <tbody>
            {[...d.months].reverse().map((m) => (
              <tr key={m.month}>
                <td>{new Date(`${m.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</td>
                <td>{m.new_paid}</td><td>{m.cancelled}</td><td>{rate(m.churn_rate)}</td><td>{m.paying_end}</td><td>{money(m.mrr, d.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {d.note && <p className="ows-sub">{d.note}</p>}
    </Section>
  );
}

function Countries() {
  const c = useTool<{ countries: any[]; unknown: number; total: number; note?: string }>('get_paid_by_country');
  if (!c.data || !c.data.total) return null;
  const d = c.data;
  return (
    <Section title="Paid subscribers by country">
      <div className="ows-bars">
        {d.countries.slice(0, 12).map((x) => (
          <div key={x.country} className="ows-bar">
            <span className="ows-bar-label">{x.name}</span>
            <span className="ows-bar-track"><span className="ows-bar-fill" style={{ width: `${Math.round((x.paid / d.total) * 100)}%` }} /></span>
            <span className="ows-bar-value">{x.paid}</span>
          </div>
        ))}
      </div>
      {d.unknown > 0 && <p className="ows-sub">{count(d.unknown, 'paid subscriber')} without a known country yet.</p>}
    </Section>
  );
}

function subjectTest(st: any): string | null {
  if (!st) return null;
  const [a, b] = st.subjects;
  const one = (s: any) => `"${s.subject}" ${Math.round(s.open_rate * 100)}%${s.winner ? ' (won)' : ''}`;
  return `Subject test: ${one(a)} vs ${one(b)}${st.status === 'testing' ? ', still testing' : ''}`;
}

export default function Stats() {
  const stats = useTool<any>('get_site_stats');
  const posts = useTool<{ posts: any[] }>('list_site_posts', { status: 'published', limit: 100 });

  if (stats.loading && !stats.data) return <Page title="Stats"><Loading what="stats" /></Page>;
  if (stats.error) return <Page title="Stats"><Failed error={stats.error} retry={stats.reload} /></Page>;
  const s = stats.data?.site || {};
  const r = s.revenue || {};
  const tiers = stats.data?.members?.active_by_tier || {};
  const total = Object.values(tiers).reduce((a: number, b: any) => a + (b || 0), 0) as number;
  const paidPlans = Object.entries(r.paid_members || {}).filter(([, n]) => (n as number) > 0);

  return (
    <Page title="Stats">
      <Grid>
        <Stat label="Subscribers" value={total.toLocaleString()} sub={`${(s.members_gained_30d ?? 0).toLocaleString()} new in 30 days`} />
        <Stat label="Views" value={(s.views_30d ?? 0).toLocaleString()} sub={`last 30 days · ${(s.views ?? 0).toLocaleString()} in all`} />
        <Stat label="Emails sent" value={(s.emails_sent ?? 0).toLocaleString()} />
        <Stat label="Posts" value={(s.posts?.published ?? 0).toLocaleString()} sub={[s.posts?.scheduled ? `${s.posts.scheduled} scheduled` : null, s.posts?.draft ? `${s.posts.draft} drafts` : null].filter(Boolean).join(' · ') || undefined} />
      </Grid>

      <Growth />
      <Traffic />

      {r.currency && (
        <Section title="Revenue">
          <Grid>
            <Stat label="Monthly revenue" value={money(r.mrr, r.currency)} sub="yearly plans counted as a twelfth" />
            <Stat label="You keep" value={money(r.writer_net, r.currency)} sub={`after OpenWriter's 5% (${money(r.openwriter_fee, r.currency)}); Stripe's fee comes off in Stripe`} />
            <Stat label="In a free trial" value={(r.trialing ?? 0).toLocaleString()} />
            <Stat label="Complimentary" value={(r.comps ?? 0).toLocaleString()} />
          </Grid>
          {paidPlans.length > 0 && <p className="ows-sub">{paidPlans.map(([plan, n]) => `${PLAN_LABEL[plan] || plan}: ${(n as number).toLocaleString()}`).join(' · ')}</p>}
        </Section>
      )}
      <Retention />
      <Countries />

      <Section title="Posts">
        {posts.loading && !posts.data && <Loading what="post stats" />}
        {posts.error && <Failed error={posts.error} retry={posts.reload} />}
        {posts.data && !posts.data.posts.length && <Empty>Stats appear here once you publish.</Empty>}
        {posts.data && posts.data.posts.length > 0 && (
          <div className="ows-table-wrap">
            <table className="ows-table">
              <thead><tr><th>Post</th><th>Views</th><th>Sent to</th><th>Opened</th><th>Clicked</th><th>Unsubscribed</th><th>New subscribers</th></tr></thead>
              <tbody>
                {posts.data.posts.map((p) => {
                  const e = p.stats?.email;
                  const st = subjectTest(p.stats?.subject_test);
                  return (
                    <tr key={p.id}>
                      <td><div className="ows-cell-title">{p.title || 'Untitled'}</div><div className="ows-cell-sub">{day(p.published_at)}{st ? ` · ${st}` : ''}</div></td>
                      <td>{(p.stats?.views ?? 0).toLocaleString()}</td>
                      <td>{e ? e.recipients.toLocaleString() : 'Not emailed'}</td>
                      <td>{e ? rate(e.open_rate) : '-'}</td>
                      <td>{e ? rate(e.click_rate) : '-'}</td>
                      <td>{e ? rate(e.unsubscribe_rate) : '-'}</td>
                      <td>{(p.stats?.members_gained ?? 0).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {!r.currency && <Notice>Connect Stripe on Money to see revenue and paid retention here.</Notice>}
    </Page>
  );
}
