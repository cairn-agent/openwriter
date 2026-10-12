/**
 * Settings tab — Connections and Plugins in one panel, so the strip keeps one
 * slot for setup screens. Each section is the former tab's body, unchanged.
 * Appearance lives beside what it changes (format bar, left rail, top bar).
 * adr: adr/right-rail.md
 */
import type { RightRailTabProps } from '../types';
import './SettingsTab.css';
import ConnectionsTab from './ConnectionsTab';
import PluginsTab from './PluginsTab';

const SECTIONS = [
  { id: 'connections', title: 'Connections', Body: ConnectionsTab },
  { id: 'plugins', title: 'Plugins', Body: PluginsTab },
];

export default function SettingsTab(props: RightRailTabProps) {
  return (
    <div className="settings-tab">
      {SECTIONS.map(({ id, title, Body }) => (
        <section key={id} className="settings-group" aria-labelledby={`settings-${id}`}>
          <h2 id={`settings-${id}`} className="settings-group-title">{title}</h2>
          <Body {...props} />
        </section>
      ))}
    </div>
  );
}
