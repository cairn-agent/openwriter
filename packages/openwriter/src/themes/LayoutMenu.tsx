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

const ICONS: Record<string, JSX.Element> = {
  files: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  timeline: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><circle cx="12" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="18" r="2"/><line x1="14" y1="6" x2="20" y2="6"/><line x1="14" y1="12" x2="20" y2="12"/><line x1="14" y1="18" x2="20" y2="18"/></svg>,
  board: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="5" height="15" rx="1"/></svg>,
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
