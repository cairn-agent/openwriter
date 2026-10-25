/**
 * Growth and Money extras: QR codes for the subscribe page, a post or an offer; the welcome
 * page's endorsements and the recommendation digest; perks for paid subscribers.
 */
import { useState } from 'react';
import { run, useTool } from './api';
import { useSite } from './SiteApp';
import { ActionBtn, Btn, Empty, Field, Notice, Row, Rows, Section, Toggle } from './ui';
import { showToast } from './toast';

export function QrCodes() {
  const posts = useTool<{ posts: any[] }>('list_site_posts', { status: 'published', limit: 50 });
  const offers = useTool<{ offers: any[] }>('list_offers');
  const [target, setTarget] = useState('subscribe');
  const [qr, setQr] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);
  const make = async () => {
    setError(null); setQr(null);
    const [kind, id] = target.split(':');
    try { setQr(await run('get_qr_code', { target: kind, ...(id ? { id } : {}) })); } catch (err: any) { setError(err?.message || 'That did not work.'); }
  };
  return (
    <Section title="QR codes">
      <p className="ows-sub">For a flyer, a slide or the back of a book: people scan it and land on the page.</p>
      <Field label="Leads to">
        <select className="ows-input" value={target} onChange={(e) => { setTarget(e.target.value); setQr(null); }}>
          <option value="subscribe">Your subscribe page</option>
          {(posts.data?.posts || []).filter((p) => p.url).map((p) => <option key={p.id} value={`post:${p.id}`}>Post: {p.title || 'Untitled'}</option>)}
          {(offers.data?.offers || []).filter((o) => o.state === 'live').map((o) => <option key={o.id} value={`offer:${o.id}`}>Offer: {o.name || o.description}</option>)}
        </select>
      </Field>
      <Btn kind="primary" onClick={() => void make()}>Make the code</Btn>
      {error && <Notice kind="error">{error}</Notice>}
      {qr && (
        <div className="ows-qr">
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`} alt={`QR code for ${qr.url}`} />
          <div>
            <p className="ows-sub">Opens {qr.url}</p>
            <div className="ows-actions">
              <a className="ows-btn" href={qr.download_url}>Download SVG</a>
              <a className="ows-btn" href={qr.png_download_url}>Download PNG</a>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

export function RecommendationSettings() {
  const { info, refresh } = useSite();
  const st = info.site?.settings || {};
  const [days, setDays] = useState<number>(st.recommendation_digest_days ?? 3);
  const set = async (patch: Record<string, unknown>) => {
    try { await run('update_site_settings', patch); refresh(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
  };
  return (
    <Section title="Recommendation settings">
      <Toggle label="Show endorsements on your welcome page" hint="What writers who recommend you said about you, under the subscribe form."
        checked={st.welcome_endorsements !== false} onChange={(v) => void set({ welcome_endorsements: v })} />
      <Toggle label="Email new subscribers your recommendations" hint="One short email a few days after they join, listing the sites you recommend. Never to people you imported or added."
        checked={!!st.recommendation_digest} onChange={(v) => void set({ recommendation_digest: v })} />
      {st.recommendation_digest && (
        <Field label="Days after joining">
          <select className="ows-input ows-select-sm" value={days} onChange={(e) => { const n = Number(e.target.value); setDays(n); void set({ recommendation_digest_days: n }); }}>
            {[1, 2, 3, 5, 7, 14].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
      )}
    </Section>
  );
}

export function Perks() {
  const perks = useTool<{ perks: any[] }>('list_perks');
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [code, setCode] = useState('');
  return (
    <Section title="Perks for paid subscribers">
      <p className="ows-sub">Shown on paid readers' account page and in their welcome email, never to free readers: a discount at a partner, a private link, a code.</p>
      {perks.data && !perks.data.perks.length && <Empty>No perks yet.</Empty>}
      {perks.data && perks.data.perks.length > 0 && (
        <Rows>
          {perks.data.perks.map((p) => (
            <Row key={p.id} title={p.text} meta={[p.link, p.code ? `Code: ${p.code}` : null].filter(Boolean).join(' · ')}
              actions={<ActionBtn kind="quiet" label="Delete" doing="Deleting..." confirm={`Delete "${p.text}"? Paid subscribers stop seeing it.`} yes="Delete"
                run={() => run('delete_perk', { perk_id: p.id })} done={(r) => { perks.reload(); return r?.message || 'Deleted.'; }} />} />
          ))}
        </Rows>
      )}
      <Field label="Perk"><input className="ows-input" maxLength={300} placeholder="20% off at the Corner Bookshop" value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="ows-grid2">
        <Field label="Link (optional)"><input className="ows-input" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value.trim())} /></Field>
        <Field label="Code (optional)"><input className="ows-input" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      </div>
      <ActionBtn kind="primary" label="Add perk" doing="Adding..." disabled={!text.trim()}
        run={() => run('save_perk', { text: text.trim(), ...(link ? { link } : {}), ...(code.trim() ? { code: code.trim() } : {}) })}
        done={(r) => { setText(''); setLink(''); setCode(''); perks.reload(); return r?.message || 'Added.'; }} />
    </Section>
  );
}
