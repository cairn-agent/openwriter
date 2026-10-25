/**
 * Growth: the referral program (on, rewards, leaderboard, who referred whom), recommendations
 * (the sites you recommend and those recommending you), and a signup form for another website.
 */
import { useEffect, useState } from 'react';
import { count, run, slugInput, useTool } from '../api';
import { useSite } from '../SiteApp';
import { ActionBtn, Empty, Failed, Field, Loading, Page, Row, Rows, Section, Tabs, Toggle } from '../ui';
import { showToast } from '../toast';
import { QrCodes, RecommendationSettings } from '../GrowthExtras';

type View = 'referrals' | 'recommendations' | 'embed' | 'qr';
const REWARDS = [['', 'No reward'], ['7d', '7 days of paid access'], ['30d', '30 days of paid access'], ['90d', '90 days of paid access'], ['6mo', '6 months of paid access'], ['1yr', '1 year of paid access']];

function Referrals() {
  const { info } = useSite();
  const ref = useTool<any>('get_site_referrals');
  const paid = !!info.payments?.stripe_connected;
  const [tiers, setTiers] = useState<Array<{ threshold: string; comp: string; reward_text: string }>>([]);
  useEffect(() => {
    const t = ref.data?.settings?.tiers || [];
    setTiers([0, 1, 2].map((i) => ({ threshold: String(t[i]?.threshold ?? [3, 10, 25][i]), comp: t[i]?.comp ?? '', reward_text: t[i]?.reward_text ?? '' })));
  }, [ref.data]);
  if (ref.loading && !ref.data) return <Loading what="referrals" />;
  if (ref.error) return <Failed error={ref.error} retry={ref.reload} />;
  const s = ref.data.settings || {};
  const set = async (patch: Record<string, unknown>) => {
    try { await run('update_site_referrals', patch); ref.reload(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
  };
  return (
    <>
      <Section title="Referral program">
        <Toggle label="Readers earn rewards for bringing subscribers" checked={!!s.enabled} onChange={(v) => void set({ enabled: v })}
          hint={s.enabled && !ref.data.live ? 'Paused while your site is private.' : 'Each subscriber gets a personal link to share.'} />
        <Toggle label="Show a public leaderboard" checked={!!s.show_leaderboard} onChange={(v) => void set({ show_leaderboard: v })} />
        <Toggle label="End post emails with the reader's referral link" checked={!!s.email_line} onChange={(v) => void set({ email_line: v })} />
      </Section>
      <Section title="Rewards">
        {tiers.map((t, i) => (
          <div className="ows-grid2" key={i}>
            <Field label={`Tier ${i + 1}: referrals needed`}>
              <input className="ows-input" inputMode="numeric" value={t.threshold} onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, threshold: e.target.value.replace(/\D/g, '') } : x))} />
            </Field>
            {paid ? (
              <Field label="Reward">
                <select className="ows-input" value={t.comp} onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, comp: e.target.value } : x))}>
                  {REWARDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
            ) : (
              <Field label="Reward (emailed to them)">
                <input className="ows-input" value={t.reward_text} onChange={(e) => setTiers(tiers.map((x, j) => j === i ? { ...x, reward_text: e.target.value } : x))} />
              </Field>
            )}
          </div>
        ))}
        <ActionBtn kind="primary" label="Save rewards" doing="Saving..."
          run={() => run('update_site_referrals', { tiers: tiers.map((t) => ({ threshold: Number(t.threshold), ...(paid && t.comp ? { comp: t.comp } : {}), ...(!paid && t.reward_text.trim() ? { reward_text: t.reward_text.trim() } : {}) })) })}
          done={(r) => { ref.reload(); return r?.granted ? `Saved. ${count(r.granted, 'reward')} given to readers who now qualify.` : 'Saved the rewards.'; }} />
      </Section>
      <Section title="Top referrers" aside={<span className="ows-sub">{count(ref.data.referrals?.confirmed, 'subscriber')} referred</span>}>
        {!ref.data.referrers?.length && <Empty>Nobody has referred anyone yet.</Empty>}
        {ref.data.referrers?.length > 0 && (
          <Rows>
            {ref.data.referrers.slice(0, 50).map((r: any) => (
              <Row key={r.membership_id} title={r.email} meta={[r.name, r.rewards?.length ? `reward tier ${r.rewards.join(', ')}` : null].filter(Boolean).join(' · ')}
                aside={<span className="ows-row-stats">{count(r.referrals, 'referral')}</span>} />
            ))}
          </Rows>
        )}
      </Section>
    </>
  );
}

function Recommendations() {
  const recs = useTool<{ recommending: any[]; recommended_by: any[] }>('list_site_recommendations');
  const [slug, setSlug] = useState('');
  const [blurb, setBlurb] = useState('');
  return (
    <>
      <Section title="Recommend a site">
        <p className="ows-sub">New subscribers see your recommendations and can join them in one click. The site is told you recommended it.</p>
        <div className="ows-grid2">
          <Field label="Site"><span className="ows-suffix"><input className="ows-input" value={slug} placeholder="their-name" onChange={(e) => setSlug(slugInput(e.target.value))} /><span>.openwriter.io</span></span></Field>
          <Field label="Why you recommend it (optional)"><input className="ows-input" maxLength={300} value={blurb} onChange={(e) => setBlurb(e.target.value)} /></Field>
        </div>
        <ActionBtn kind="primary" label="Recommend" doing="Saving..." disabled={slug.length < 3}
          run={() => run('recommend_site', { slug, ...(blurb.trim() ? { blurb: blurb.trim() } : {}) })}
          done={() => { setSlug(''); setBlurb(''); recs.reload(); return `You now recommend ${slug}.openwriter.io.`; }} />
      </Section>
      {recs.error && <Failed error={recs.error} retry={recs.reload} />}
      {recs.loading && !recs.data && <Loading what="recommendations" />}
      {recs.data && (
        <>
          <Section title="You recommend">
            {!recs.data.recommending.length && <Empty>No recommendations yet.</Empty>}
            <Rows>
              {recs.data.recommending.map((r) => (
                <Row key={r.slug} title={r.name || r.slug} meta={[`${r.slug}.openwriter.io`, r.blurb].filter(Boolean).join(' · ')}
                  aside={<span className="ows-row-stats">{count(r.given, 'subscriber')} sent</span>}
                  actions={<ActionBtn kind="quiet" label="Remove" doing="Removing..." confirm={`Stop recommending ${r.name || r.slug}?`} yes="Remove"
                    run={() => run('remove_site_recommendation', { slug: r.slug })} done={() => { recs.reload(); return `Stopped recommending ${r.name || r.slug}.`; }} />} />
              ))}
            </Rows>
          </Section>
          <Section title="Recommending you">
            {!recs.data.recommended_by.length && <Empty>No site recommends you yet.</Empty>}
            <Rows>
              {recs.data.recommended_by.map((r) => (
                <Row key={r.slug} title={r.name || r.slug} meta={`${r.slug}.openwriter.io${r.live ? '' : ' · stopped'}`}
                  aside={<span className="ows-row-stats">{count(r.gained, 'subscriber')} gained</span>} />
              ))}
            </Rows>
          </Section>
        </>
      )}
    </>
  );
}

function Embed() {
  const e = useTool<{ subscribe_url: string; embed_html: string }>('get_subscribe_embed');
  if (e.loading && !e.data) return <Loading what="the signup form" />;
  if (e.error) return <Failed error={e.error} retry={e.reload} />;
  return (
    <Section title="Signup form for another website">
      <p className="ows-sub">Paste this into any web page. People who sign up join your subscribers, with the same confirmation rules as your site.</p>
      <textarea className="ows-input ows-code" rows={8} readOnly value={e.data!.embed_html} />
      <ActionBtn label="Copy the code" doing="Copying..." run={async () => { await navigator.clipboard?.writeText(e.data!.embed_html); }} done={() => 'Copied.'} />
    </Section>
  );
}

export default function Growth() {
  const [view, setView] = useState<View>('referrals');
  return (
    <Page title="Growth">
      <Tabs label="Growth" value={view} onChange={setView} options={[
        { value: 'referrals', label: 'Referrals' }, { value: 'recommendations', label: 'Recommendations' }, { value: 'embed', label: 'Signup form' }, { value: 'qr', label: 'QR codes' },
      ]} />
      {view === 'referrals' && <Referrals />}
      {view === 'recommendations' && <><Recommendations /><RecommendationSettings /></>}
      {view === 'embed' && <Embed />}
      {view === 'qr' && <QrCodes />}
    </Page>
  );
}
