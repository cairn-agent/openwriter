import { useEffect, useRef, useState } from 'react';

interface WorkspaceOption { filename: string; title: string }

interface WorkspaceFilterProps {
  workspaces: WorkspaceOption[];
  value: string;
  onChange: (filename: string) => void;
}

/** The Timeline's workspace filter: the app's own menu (not the browser's), shown only once a workspace exists. */
export default function WorkspaceFilter({ workspaces, value, onChange }: WorkspaceFilterProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const options: WorkspaceOption[] = [{ filename: '', title: 'All workspaces' }, ...workspaces];
  const current = options.find(o => o.filename === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const show = () => { setActive(Math.max(0, options.findIndex(o => o.filename === current.filename))); setOpen(true); };
  const pick = (filename: string) => { onChange(filename); setOpen(false); buttonRef.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(options.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(options[active].filename); }
  };

  return (
    <div className="ws-filter" ref={rootRef} onKeyDown={onKey}>
      <button ref={buttonRef} type="button" className="ws-filter-button" aria-label="Timeline workspace" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}>
        <span className="ws-filter-label">{current.title}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="ws-filter-menu" role="listbox" aria-label="Timeline workspace">
          {options.map((o, i) => (
            <div key={o.filename || 'all'} role="option" aria-selected={o.filename === current.filename}
              className={`ws-filter-item${i === active ? ' active' : ''}${o.filename === current.filename ? ' selected' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(o.filename)}>
              {o.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
