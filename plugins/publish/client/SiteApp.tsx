/**
 * The site dashboard's frame: Back to writing, the site (and a picker when the writer has more
 * than one), the pages in Substack's order, and the page itself. The site's own details load once
 * here and every page reads them from SiteContext.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { callTool } from './bridge';
import { followProfile, host, run, setSiteKey, useSiteKey, useTool } from './api';
import { close, go, useNav, type SitePage } from './nav';
import { Btn, Failed, Field, Loading, Notice } from './ui';
import Home from './pages/Home';
import Posts from './pages/Posts';
import Publish from './pages/Publish';
import Subscribers from './pages/Subscribers';
import Stats from './pages/Stats';
import Comments from './pages/Comments';
import Surveys from './pages/Surveys';
import Growth from './pages/Growth';
import Money from './pages/Money';
import Settings from './pages/Settings';

export interface SiteInfo {
  address: string | null;
  role: 'owner' | 'admin' | 'contributor';
  sending: { status: string; daily_cap: number | null; review_requested_at: string | null };
  site: any;
  payments?: any;
  sender?: any;
  /** The caller's own team row on a site they do not own (get_site team_id). */
  team_id?: string | null;
}

interface Ctx { info: SiteInfo; refresh: () => void }
const SiteContext = createContext<Ctx | null>(null);

export function useSite(): Ctx {
  const c = useContext(SiteContext);
  if (!c) throw new Error('useSite outside the site dashboard');
  return c;
}

const NAV: Array<{ page: SitePage; label: string; manage?: boolean }> = [
  { page: 'home', label: 'Home' },
  { page: 'posts', label: 'Posts' },
  { page: 'subscribers', label: 'Subscribers', manage: true },
  { page: 'stats', label: 'Stats', manage: true },
  { page: 'comments', label: 'Comments', manage: true },
  { page: 'surveys', label: 'Surveys', manage: true },
  { page: 'growth', label: 'Growth', manage: true },
  { page: 'money', label: 'Money', manage: true },
  { page: 'settings', label: 'Settings' },
];

function Connect({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const goOn = async () => {
    setBusy(true); setError(null);
    try {
      if (!sent) { await callTool('request_login_code', { email: email.trim() }); setSent(true); }
      else { await callTool('verify_login', { email: email.trim(), code: code.trim() }); onDone(); }
    } catch (err: any) { setError(err?.message || 'That did not work.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="ows-page ows-narrow">
      <h1 className="ows-h1">Connect your site</h1>
      <p className="ows-sub">We email you a 6-digit code to connect this account to your OpenWriter site.</p>
      <Field label="Email"><input className="ows-input" type="email" autoComplete="email" value={email} disabled={sent} onChange={(e) => setEmail(e.target.value)} /></Field>
      {sent && <Field label="Code"><input className="ows-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} autoFocus /></Field>}
      {error && <Notice kind="error">{error}</Notice>}
      <Btn kind="primary" disabled={busy || !email.includes('@') || (sent && code.trim().length < 6)} onClick={() => void goOn()}>
        {busy ? (sent ? 'Connecting...' : 'Sending...') : sent ? 'Connect' : 'Send me a code'}
      </Btn>
    </div>
  );
}

/**
 * Which site the dashboard shows, for a writer on more than one. With one there is nothing to pick:
 * the header shows its address (an unnamed site is called after its profile, "Default").
 */
function SitePicker({ current }: { current: string | null }) {
  const key = useSiteKey();
  const mine = useTool<{ sites: Array<{ id: string; slug: string | null; name: string | null; role: string }> }>('list_my_sites');
  const sites = mine.data?.sites || [];
  // A remembered site the writer is no longer on falls back to their own.
  useEffect(() => { if (key && mine.data && !sites.some((s) => s.id === key || s.slug === key)) setSiteKey(null); }, [key, mine.data]);
  if (sites.length < 2) return null;
  return (
    <select className="ows-picker" aria-label="Site" value={current ?? ''} onChange={(e) => setSiteKey(e.target.value || null)}>
      {sites.map((s) => (
        <option key={s.id} value={s.id}>{s.name || (s.slug ? `${s.slug}.openwriter.io` : 'Unnamed site')}{s.role !== 'owner' ? ` (${s.role})` : ''}</option>
      ))}
    </select>
  );
}

function PageFor({ page }: { page: SitePage }) {
  switch (page) {
    case 'home': return <Home />;
    case 'posts': return <Posts />;
    case 'publish': return <Publish />;
    case 'subscribers': return <Subscribers />;
    case 'stats': return <Stats />;
    case 'comments': return <Comments />;
    case 'surveys': return <Surveys />;
    case 'growth': return <Growth />;
    case 'money': return <Money />;
    case 'settings': return <Settings />;
  }
}

export default function SiteApp() {
  const nav = useNav();
  const key = useSiteKey();
  const [info, setInfo] = useState<SiteInfo | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'disconnected' | 'error'>('loading');
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    setState('loading');
    followProfile()
      .then(() => run<SiteInfo>('get_site'))
      .then((i) => { if (live) { setInfo(i); setState('ready'); } })
      .catch((err: any) => {
        if (!live) return;
        const msg = err?.message || '';
        if (/log ?in|sign ?in|api key|not connected|connect/i.test(msg)) setState('disconnected');
        else { setError(msg || 'Your site did not load.'); setState('error'); }
      });
    return () => { live = false; };
  }, [key, tick]);

  useEffect(() => {
    const before = document.title;
    document.title = 'Your site · OpenWriter';
    return () => { document.title = before; };
  }, []);

  const refresh = () => setTick((t) => t + 1);
  const manager = info?.role === 'owner' || info?.role === 'admin';

  return (
    <div className="ows-app">
      <header className="ows-top">
        <button type="button" className="ows-back" onClick={close}>
          <span aria-hidden="true">←</span> Back to writing
        </button>
        <div className="ows-top-site">
          <SitePicker current={info?.site?.id ?? null} />
          {info?.address && <a className="ows-top-link" href={info.address} target="_blank" rel="noopener noreferrer">{host(info.address)} ↗</a>}
        </div>
      </header>
      <div className="ows-body">
        <nav className="ows-nav" aria-label="Site dashboard">
          {NAV.filter((n) => !n.manage || manager || !info).map((n) => (
            <button key={n.page} type="button" className={`ows-nav-item${nav.page === n.page ? ' ows-nav-item--on' : ''}`}
              aria-current={nav.page === n.page ? 'page' : undefined} onClick={() => go(n.page)}>
              {n.label}
            </button>
          ))}
        </nav>
        <main className="ows-main">
          {state === 'loading' && <div className="ows-page"><Loading what="your site" /></div>}
          {state === 'error' && <div className="ows-page"><Failed error={error} retry={refresh} /></div>}
          {state === 'disconnected' && <Connect onDone={refresh} />}
          {state === 'ready' && info && (
            <SiteContext.Provider value={{ info, refresh }}>
              <PageFor page={nav.page} />
            </SiteContext.Provider>
          )}
        </main>
      </div>
    </div>
  );
}
