/**
 * Plugins tab — list available plugins, toggle each on/off, configure them.
 * Migrated from src/plugins/PluginPanel.tsx (titlebar dropdown).
 * adr: adr/right-rail.md
 */
import { useCallback, useEffect, useState } from 'react';
import type { RightRailTabProps } from '../types';
import GithubPluginSettings from './plugin-panels/GithubPluginSettings';
import { useUiText } from '../../plugins/client-plugins';
import './PluginsTab.css';

interface ConfigField {
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  env?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
}

interface AvailablePlugin {
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  configSchema: Record<string, ConfigField>;
  config: Record<string, string>;
  displayName?: string;
  /** Part of the program running OpenWriter: always on, no switch. */
  required?: boolean;
}

function displayName(name: string, given?: string): string {
  if (given) return given;
  return name
    .replace(/^@openwriter\/plugin-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// Inline per-field save indicator. Mirrors the saving/saved/error stages +
// green checkmark "Saved" language from src/connections/ConnectionConfigModal.tsx.
function ConfigSaveStatus({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return <span className="plugin-config-status plugin-config-status--saving">Saving…</span>;
  }
  if (status === 'saved') {
    return (
      <span className="plugin-config-status plugin-config-status--saved">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        Saved
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="plugin-config-status plugin-config-status--error">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        Failed
      </span>
    );
  }
  return null;
}

export default function PluginsTab(_props: RightRailTabProps) {
  const [plugins, setPlugins] = useState<AvailablePlugin[]>([]);
  const [loadingPlugin, setLoadingPlugin] = useState<string | null>(null);
  const [expandedConfigs, setExpandedConfigs] = useState<Set<string>>(new Set());
  // Per-field save state, keyed `${pluginName}:${configKey}`. Drives the inline ✓/✗ indicator.
  const [saveStatus, setSaveStatus] = useState<Record<string, SaveStatus>>({});
  const setupHint = useUiText('plugins.setupHint', 'Ask your agent: “set up {name}”');

  const fetchPlugins = useCallback(() => {
    fetch('/api/available-plugins')
      .then((r) => r.json())
      // A plugin that is part of the program running OpenWriter (no switch) and has nothing to
      // set gives the writer nothing to do here, so it is not listed.
      .then((data) => setPlugins(((data.plugins || []) as AvailablePlugin[])
        .filter((p) => !(p.required && Object.keys(p.configSchema || {}).length === 0))))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  useEffect(() => {
    const handler = () => fetchPlugins();
    window.addEventListener('ow-plugins-changed', handler);
    return () => window.removeEventListener('ow-plugins-changed', handler);
  }, [fetchPlugins]);

  const handleToggle = useCallback(async (name: string, currentlyEnabled: boolean) => {
    setLoadingPlugin(name);
    try {
      const endpoint = currentlyEnabled ? '/api/plugins/disable' : '/api/plugins/enable';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) fetchPlugins();
    } catch { /* ignore */ } finally {
      setLoadingPlugin(null);
    }
  }, [fetchPlugins]);

  const handleConfigBlur = useCallback(async (pluginName: string, key: string, value: string) => {
    const statusKey = `${pluginName}:${key}`;
    setSaveStatus((prev) => ({ ...prev, [statusKey]: 'saving' }));
    try {
      const res = await fetch('/api/plugins/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pluginName, config: { [key]: value } }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setSaveStatus((prev) => ({ ...prev, [statusKey]: 'saved' }));
      // Auto-clear the ✓ after ~2s — but only if nothing newer has touched this field.
      setTimeout(() => {
        setSaveStatus((prev) => (prev[statusKey] === 'saved' ? { ...prev, [statusKey]: 'idle' } : prev));
      }, 2000);
    } catch {
      setSaveStatus((prev) => ({ ...prev, [statusKey]: 'error' }));
    }
  }, []);

  return (
    <div className="plugins-tab">
      {plugins.length === 0 ? (
        <div className="plugin-empty">No plugins found</div>
      ) : (
        plugins.map((p) => (
          <div key={p.name} className="plugin-item">
            <div className="plugin-item-header">
              <div className="plugin-item-info">
                <div className="plugin-item-name">
                  {displayName(p.name, p.displayName)}
                  <span className="plugin-item-version">v{p.version}</span>
                </div>
                {p.description && (
                  <div className="plugin-item-desc">{p.description}</div>
                )}
              </div>
              {!p.required && <label className={`plugin-toggle${loadingPlugin === p.name ? ' loading' : ''}`}>
                <input
                  type="checkbox"
                  checked={p.enabled}
                  disabled={loadingPlugin === p.name}
                  onChange={() => handleToggle(p.name, p.enabled)}
                />
                <span className="plugin-toggle-track" />
                <span className="plugin-toggle-thumb" />
              </label>}
            </div>
            {p.enabled && (() => {
              const entries = Object.entries(p.configSchema || {});
              // `select`-type fields (e.g. the AV model picker) surface at the top level —
              // always visible. Text/password fields (API keys, secrets, URLs) stay tucked
              // inside the collapse. Generic: runs identically for every plugin.
              const topLevel = entries.filter(([, field]) => field.type === 'select');
              const collapsed = entries.filter(([, field]) => field.type !== 'select');
              const needsSetup = entries.some(([key, field]) => field.required && !p.config[key]);

              // Plugin-specific rich panel (github settings). Rendered BETWEEN the top-level
              // selects and the Settings collapse; secrets stay last behind the collapse.
              // No-op for plugins without a panel.
              const richPanel =
                p.name === '@openwriter/plugin-github' ? <GithubPluginSettings /> : null;

              const renderField = (key: string, field: ConfigField) => {
                const status = saveStatus[`${p.name}:${key}`] || 'idle';
                return (
                  <div key={key} className="plugin-config-field">
                    <label className="plugin-config-label">
                      {field.description || key}
                      <ConfigSaveStatus status={status} />
                    </label>
                    {field.options ? (
                      <select
                        className="plugin-config-input"
                        defaultValue={p.config[key] || ''}
                        onChange={(e) => handleConfigBlur(p.name, key, e.target.value)}
                      >
                        {!field.required && !field.options.some((o) => o.value === '') && <option value="">—</option>}
                        {field.options.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="plugin-config-input"
                        type={key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') ? 'password' : 'text'}
                        defaultValue={p.config[key] || ''}
                        placeholder={field.env ? `$${field.env}` : ''}
                        onBlur={(e) => handleConfigBlur(p.name, key, e.target.value)}
                      />
                    )}
                  </div>
                );
              };

              // Nothing to show (no config fields, no rich panel) → render nothing rather than
              // an empty bordered section box.
              if (entries.length === 0 && !richPanel) return null;

              return (
                <div className="plugin-config-section">
                  {needsSetup && setupHint && (
                    <div className="plugin-setup-hint">
                      {setupHint.replace('{name}', displayName(p.name, p.displayName))}
                    </div>
                  )}
                  {topLevel.length > 0 && (
                    <div className="plugin-config">
                      {topLevel.map(([key, field]) => renderField(key, field))}
                    </div>
                  )}
                  {richPanel}
                  {collapsed.length > 0 && (
                    <>
                      <button
                        className="plugin-config-toggle"
                        onClick={() => setExpandedConfigs((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.name)) next.delete(p.name);
                          else next.add(p.name);
                          return next;
                        })}
                      >
                        <svg
                          className={`plugin-config-chevron${expandedConfigs.has(p.name) ? ' plugin-config-chevron--open' : ''}`}
                          width="12" height="12" viewBox="0 0 24 24" fill="none"
                          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                        Settings
                      </button>
                      {expandedConfigs.has(p.name) && (
                        <div className="plugin-config">
                          {collapsed.map(([key, field]) => renderField(key, field))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        ))
      )}
    </div>
  );
}
