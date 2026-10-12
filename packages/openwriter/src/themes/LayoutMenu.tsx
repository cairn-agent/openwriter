/**
 * Layout switch (Files, Timeline, Board) on the left rail: in the search row,
 * and beside the board's search in Board mode, so it never disappears.
 * adr: adr/right-rail.md
 */
import { useCallback, useRef, useState } from 'react';
import type { JSX } from 'react';
import { SIDEBAR_MODES, updateAppearance } from './appearance-store';
import { useAppearance } from './useAppearance';
import Popover from './Popover';

// 16px at the app's chrome weight (1.75). Timeline is two dated entries on a line,
// so its parts have room at this size.
const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
const ICONS: Record<string, JSX.Element> = {
  files: <svg {...svg}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  timeline: <svg {...svg}><path d="M6 3v1.5M6 9.5v5M6 19.5V21"/><circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M12 7h8M12 17h6"/></svg>,
  board: <svg {...svg}><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="15" rx="1"/></svg>,
};

export default function LayoutMenu({ className }: { className: string }) {
  const { sidebarMode } = useAppearance();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const current = SIDEBAR_MODES.find((m) => m.id === sidebarMode) ?? SIDEBAR_MODES[0];

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${className}${open ? ' active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={`Layout: ${current.label}`}
        aria-label={`Layout: ${current.label}`}
        aria-expanded={open}
      >
        {ICONS[current.icon]}
      </button>
      {open && (
        <Popover anchor={anchor} onClose={close} label="Layout">
          <div className="appearance-section">
            <div className="appearance-section-title">Layout</div>
            <div className="appearance-grid appearance-grid--3">
              {SIDEBAR_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`appearance-option appearance-option--icon${sidebarMode === m.id ? ' active' : ''}`}
                  onClick={() => { updateAppearance({ sidebarMode: m.id }); close(); }}
                  aria-pressed={sidebarMode === m.id}
                >
                  {ICONS[m.icon]}
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
