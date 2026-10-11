/**
 * The writer's Anthropic API key: paste once, saved on the server, shown back
 * only as its last four characters, removable. Chat and Rewrite run on it.
 */
import { useCallback, useEffect, useState } from 'react';
import { getAiStatus, KEY_CHANGED_EVENT, removeAnthropicKey, saveAnthropicKey, type KeyState } from './ai-api';
import './ai.css';

export function useAnthropicKey(): { key: KeyState | null; refresh: () => void } {
  const [key, setKey] = useState<KeyState | null>(null);
  const refresh = useCallback(() => {
    getAiStatus().then((s) => setKey(s.key)).catch(() => setKey({ saved: false }));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener(KEY_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(KEY_CHANGED_EVENT, refresh);
  }, [refresh]);
  return { key, refresh };
}

export default function AnthropicKeyForm({ compact = false }: { compact?: boolean }) {
  const { key } = useAnthropicKey();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await saveAnthropicKey(value.trim());
      setValue('');
    } catch (err: any) {
      setError(err?.message || 'Could not save the key.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try { await removeAnthropicKey(); } finally { setBusy(false); }
  };

  if (!key) return null;

  return (
    <div className={`ai-key-form${compact ? ' ai-key-form--compact' : ''}`}>
      <div className="ai-key-title">Anthropic API key</div>
      {key.saved && key.usable !== false ? (
        <div className="ai-key-saved">
          <span>Saved: <code>sk-ant-…{key.last4}</code></span>
          <button type="button" className="ai-link-btn" onClick={remove} disabled={busy}>Remove</button>
        </div>
      ) : (
        <>
          {key.saved && key.usable === false && (
            <p className="ai-key-error">The saved key can no longer be read. Paste it again.</p>
          )}
          <div className="ai-key-row">
            <input
              type="password"
              className="plugin-config-input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              placeholder="sk-ant-..."
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="ai-key-save" onClick={save} disabled={busy || !value.trim()}>Save</button>
          </div>
          {error && <p className="ai-key-error">{error}</p>}
        </>
      )}
      <p className="ai-key-help">
        The chat and Rewrite run on your own Anthropic key. Create one in the{' '}
        <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">Anthropic console</a>{' '}
        under API keys. A Claude Max plan includes monthly API credit:{' '}
        <a href="https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers" target="_blank" rel="noreferrer">claim it in the console</a>, then create the key.
        The key stays on this server; it is never shown again.
      </p>
    </div>
  );
}
