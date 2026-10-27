import { useEffect, useRef, useState } from 'react';
import { DOCUMENTS, setWorkspacePick } from './workspace-pick';

interface WorkspaceOption { filename: string; title: string }

interface WorkspacePickerProps {
  workspaces: WorkspaceOption[];
  /** The pick shown: a workspace filename or DOCUMENTS. */
  value: string;
  /** Picks with agent changes waiting. */
  pending: Set<string>;
  /** Some documents are in no workspace, so the first-time hint has somewhere to point. */
  hasLooseDocs: boolean;
  onCreateWorkspace: () => void;
  /** Shown instead of the picker while the workspace is being named. */
  renameInput?: React.ReactNode;
}

const HINT_KEY = 'ow-workspace-pick-hint';
const readHintSeen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };

/** The sidebar's workspace picker: the app's own menu, one workspace (or Documents) at a time. adr: adr/workspace-pick.md */
export default function WorkspacePicker({ workspaces, value, pending, hasLooseDocs, onCreateWorkspace, renameInput }: WorkspacePickerProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [hintSeen, setHintSeen] = useState(readHintSeen);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const options: WorkspaceOption[] = [{ filename: DOCUMENTS, title: 'Documents' }, ...workspaces];
  const current = options.find(o => o.filename === value) ?? options[0];
  const pendingElsewhere = [...pending].some(p => p !== current.filename);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const dismissHint = () => { setHintSeen(true); try { localStorage.setItem(HINT_KEY, '1'); } catch { /* shown again next time */ } };
  const show = () => { dismissHint(); setActive(Math.max(0, options.findIndex(o => o.filename === current.filename))); setOpen(true); };
  const pick = (filename: string) => { setWorkspacePick(filename); setOpen(false); buttonRef.current?.focus(); };
  const create = () => { setOpen(false); onCreateWorkspace(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(options.length, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (active === options.length) create(); else pick(options[active].filename); }
  };

  return (
    <div className="ws-picker" ref={rootRef} onKeyDown={onKey}>
      {renameInput ?? (
        <button ref={buttonRef} type="button" className="ws-picker-button" aria-label="Workspace" aria-haspopup="listbox" aria-expanded={open}
          onClick={() => (open ? setOpen(false) : show())}>
          <span className="ws-picker-label">{current.title}</span>
          {pendingElsewhere && <span className="ws-picker-dot" title="Changes waiting in another workspace" />}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {open && (
        <div className="ws-picker-menu">
          <div role="listbox" aria-label="Workspace">
            {options.map((o, i) => (
              <div key={o.filename} role="option" aria-selected={o.filename === current.filename}
                className={`ws-picker-item${i === active ? ' active' : ''}${o.filename === current.filename ? ' selected' : ''}${i === 0 ? ' is-documents' : ''}`}
                onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(o.filename)}>
                <span className="ws-picker-item-label">{o.title}</span>
                {pending.has(o.filename) && <span className="ws-picker-dot" title="Changes waiting" />}
              </div>
            ))}
          </div>
          <button type="button" className={`ws-picker-new${active === options.length ? ' active' : ''}`}
            onMouseEnter={() => setActive(options.length)} onMouseDown={e => e.preventDefault()} onClick={create}>+ New workspace</button>
        </div>
      )}
      {!hintSeen && hasLooseDocs && current.filename !== DOCUMENTS && (
        <p className="ws-picker-hint">Your other documents are under Documents. <button type="button" aria-label="Dismiss" onClick={dismissHint}>×</button></p>
      )}
    </div>
  );
}
