/**
 * Settings > Claude without a key, signed in to OpenWriter: the OpenWriter balance that pays for
 * Claude (free Haiku rewrites and the first 10,000 words of Learn my voice; the rest at twice
 * what it costs OpenWriter). Top-ups open Stripe in a new tab; the balance is read again when
 * the writer comes back. adr: adr/authors-voice.md
 */
import { useCallback, useEffect, useState } from 'react';

interface Balance {
  balance_hc: number;
  threshold_hc: number;
  auto_topup_cents: number | null;
  card: { brand: string | null; last4: string | null } | null;
  free_rewrites_left: number;
  free_rewrites_per_day: number;
  free_learn_words_left: number;
  topup_amounts_cents: number[];
  recent: Array<{ kind: string; job: string | null; model: string | null; price_hc: number; at: string }>;
}

/** hc (hundredths of a cent) → "$1.23"; under a cent shows as "<1¢". */
function money(hc: number): string {
  const abs = Math.abs(hc);
  if (abs > 0 && abs < 100) return '<1¢';
  return `$${(Math.floor(abs / 100) / 100).toFixed(2)}`;
}

const JOB_LABEL: Record<string, string> = { rewrite: 'Rewrite', learn: 'Learn my voice', transform: 'Transform', image: 'Picture', sending: 'Newsletter sending' };
const KIND_LABEL: Record<string, string> = { topup: 'Top-up', auto_topup: 'Auto top-up', starting: 'Starting balance' };

function line(r: Balance['recent'][number]): string {
  if (r.price_hc < 0) return `${KIND_LABEL[r.kind] ?? 'Added'}  +${money(r.price_hc)}`;
  const model = r.model ? (/claude-(\w+)/.exec(r.model)?.[1] ?? '') : '';
  const what = JOB_LABEL[r.job ?? ''] ?? 'Claude';
  return `${what}${model ? ` · ${model[0].toUpperCase()}${model.slice(1)}` : ''}  ${money(r.price_hc)}`;
}

export default function ClaudeBalance() {
  const [b, setB] = useState<Balance | null>(null);
  const [saveCard, setSaveCard] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/voice/balance').then(async (r) => {
      const data = await r.json().catch(() => null);
      if (r.ok) { setB(data); setError(null); } else setError(data?.message || 'Could not read your balance.');
    }).catch(() => setError('Could not read your balance.'));
  }, []);

  useEffect(() => {
    load();
    // Back from Stripe's page: the top-up shows on the next read.
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const send = useCallback(async (method: string, path: string, body?: unknown) => {
    setError(null);
    const r = await fetch(`/api/voice/balance${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    const data = await r?.json().catch(() => null);
    if (!r?.ok) { setError(data?.message || 'That did not work. Try again.'); return null; }
    return data;
  }, []);

  const topUp = useCallback(async (cents: number) => {
    const data = await send('POST', '/topup', { amount_cents: cents, save_card: saveCard });
    if (data?.url) window.open(data.url, '_blank', 'noopener');
  }, [send, saveCard]);

  const settings = useCallback(async (body: { threshold_cents?: number; auto_topup_cents?: number | null }) => {
    if (await send('PUT', '/settings', body)) load();
  }, [send, load]);

  if (!b) return error ? <div className="claude-settings-error">{error}</div> : null;
  // A new account's starting credit, while it is still among the recent entries.
  const starting = b.recent.find((r) => r.kind === 'starting');

  return (
    <div className="claude-balance">
      <div className="claude-balance-amount">
        <span className="plugin-config-label">OpenWriter balance</span>
        <span className="claude-balance-value">{money(b.balance_hc)}</span>
      </div>
      {starting && (
        <p className="claude-settings-note">Your account started with {money(starting.price_hc)} of credit from OpenWriter.</p>
      )}
      <p className="claude-settings-note">
        Free: {b.free_rewrites_left} of {b.free_rewrites_per_day} Haiku rewrites left today
        {b.free_learn_words_left > 0 ? `, and Learn my voice for ${b.free_learn_words_left.toLocaleString()} more words` : ''}.
        Everything else is paid from your balance, at twice what it costs OpenWriter.
      </p>

      <div className="plugin-config-field">
        <span className="plugin-config-label">Top up</span>
        <div className="claude-balance-topups">
          {b.topup_amounts_cents.map((c) => (
            <button key={c} className="claude-balance-btn" onClick={() => topUp(c)}>${c / 100}</button>
          ))}
        </div>
        {!b.card && (
          <label className="claude-balance-check">
            <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />
            Save my card for auto top-up
          </label>
        )}
      </div>

      <div className="plugin-config-field">
        <label className="plugin-config-label" htmlFor="claude-threshold">Email me when it falls below</label>
        <select id="claude-threshold" className="plugin-config-input" value={Math.round(b.threshold_hc / 100)}
          onChange={(e) => settings({ threshold_cents: Number(e.target.value) })}>
          {[100, 200, 500, 1000].map((c) => <option key={c} value={c}>${c / 100}</option>)}
        </select>
      </div>

      <div className="plugin-config-field">
        <label className="plugin-config-label" htmlFor="claude-auto">Auto top-up</label>
        <select id="claude-auto" className="plugin-config-input" value={b.auto_topup_cents ?? ''} disabled={!b.card}
          onChange={(e) => settings({ auto_topup_cents: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Off</option>
          {b.topup_amounts_cents.map((c) => <option key={c} value={c}>Add ${c / 100} when it falls below</option>)}
        </select>
        {b.card ? (
          <div className="claude-settings-saved">
            <span>{b.card.brand ? `${b.card.brand[0].toUpperCase()}${b.card.brand.slice(1)}` : 'Card'} ending {b.card.last4}</span>
            <button className="claude-settings-remove" onClick={async () => { if (await send('DELETE', '/card')) load(); }}>Remove</button>
          </div>
        ) : (
          <p className="claude-settings-note">Top up once with your card saved to turn this on.</p>
        )}
      </div>

      {b.recent.length > 0 && (
        <div className="plugin-config-field">
          <span className="plugin-config-label">Recent</span>
          <ul className="claude-balance-recent">
            {b.recent.slice(0, 8).map((r, i) => <li key={i}>{line(r)}</li>)}
          </ul>
        </div>
      )}
      {error && <div className="claude-settings-error">{error}</div>}
    </div>
  );
}
