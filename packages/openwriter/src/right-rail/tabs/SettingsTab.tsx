/**
 * Settings tab — three tabs along its top, one job each: Billing (what pays for Claude: the
 * OpenWriter balance or the writer's own key, and the writing model, since the model decides
 * the cost), Accounts (X, LinkedIn) and Plugins. The strip keeps one slot for setup screens;
 * the last tab looked at is remembered, and openRailTab('billing' | 'accounts' | 'plugins')
 * opens Settings on that tab. Appearance lives beside what it changes (format bar, left rail,
 * top bar). adr: adr/right-rail.md
 */
import { useEffect, useState } from 'react';
import { onSettingsSection, takeSettingsSection, type RightRailTabProps, type SettingsSection } from '../types';
import './SettingsTab.css';
import ClaudeSettings from './ClaudeSettings';
import ConnectionsTab from './ConnectionsTab';
import PluginsTab from './PluginsTab';

const SECTIONS: Array<{ id: SettingsSection; title: string; Body: (props: RightRailTabProps) => JSX.Element | null }> = [
  { id: 'billing', title: 'Billing', Body: ClaudeSettings },
  { id: 'accounts', title: 'Accounts', Body: ConnectionsTab },
  { id: 'plugins', title: 'Plugins', Body: PluginsTab },
];

const LAST_KEY = 'ow-settings-section';

function lastSection(): SettingsSection {
  try {
    const s = localStorage.getItem(LAST_KEY);
    if (SECTIONS.some((x) => x.id === s)) return s as SettingsSection;
  } catch { /* private window */ }
  return 'billing';
}

export default function SettingsTab(props: RightRailTabProps) {
  const [section, setSection] = useState<SettingsSection>(() => takeSettingsSection() ?? lastSection());
  useEffect(() => onSettingsSection(setSection), []);
  useEffect(() => {
    try { localStorage.setItem(LAST_KEY, section); } catch { /* private window */ }
  }, [section]);
  const { Body } = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  return (
    <div className="settings-tab">
      <div className="settings-tabs" role="tablist" aria-label="Settings">
        {SECTIONS.map(({ id, title }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`settings-tab-${id}`}
            aria-selected={section === id}
            aria-controls="settings-panel"
            className={`settings-tabs-btn${section === id ? ' settings-tabs-btn--on' : ''}`}
            onClick={() => setSection(id)}
          >
            {title}
          </button>
        ))}
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`} className="settings-panel">
        <Body {...props} />
      </div>
    </div>
  );
}
