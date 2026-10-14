/**
 * Settings > Claude: the writer's Claude API key and writing model, used by Enhance and the other
 * right-click writing actions, Learn my voice from this, and the transforms. The server keeps the
 * key; this panel only ever sees whether one is saved and its last four characters.
 * adr: adr/authors-voice.md
 */
import { useCallback, useEffect, useState } from 'react';

interface ClaudeSettingsState {
  managed: boolean;
  saved: boolean;
  last4: string | null;
  model: string;
  models: Array<{ choice: string; label: string }>;
}

export default function ClaudeSettings() {
  const [state, setState] = useState<ClaudeSettingsState | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/voice/settings').then((r) => r.json()).then(setState).catch(() => {});
  }, []);

  const save = useCallback(async (body: { key?: string | null; model?: string }) => {
    setError(null);
    const res = await fetch('/api/voice/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) { setError(data?.error || 'Could not save.'); return; }
    setState(data);
    setDraft('');
  }, []);

  if (!state) return null;

  return (
    <div className="claude-settings plugin-config">
      <p className="claude-settings-note">
        Enhance and the other right-click writing actions, Learn my voice, and the transforms run on
        your own Claude API key, from the Anthropic console.
      </p>
      {!state.managed && (
        <div className="plugin-config-field">
          <label className="plugin-config-label" htmlFor="claude-key">API key</label>
          {state.saved ? (
            <div className="claude-settings-saved">
              <span>Saved, ending in {state.last4}</span>
              <button className="claude-settings-remove" onClick={() => save({ key: null })}>Remove</button>
            </div>
          ) : (
            <input
              id="claude-key"
              className="plugin-config-input"
              type="password"
              autoComplete="off"
              placeholder="sk-ant-..."
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (draft.trim()) save({ key: draft.trim() }); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) save({ key: draft.trim() }); }}
            />
          )}
        </div>
      )}
      <div className="plugin-config-field">
        <label className="plugin-config-label" htmlFor="claude-model">Writing model</label>
        <select
          id="claude-model"
          className="plugin-config-input"
          value={state.model}
          onChange={(e) => save({ model: e.target.value })}
        >
          <option value="">Default (Opus)</option>
          {state.models.map((m) => <option key={m.choice} value={m.choice}>{m.label}</option>)}
        </select>
      </div>
      {error && <div className="claude-settings-error">{error}</div>}
    </div>
  );
}
