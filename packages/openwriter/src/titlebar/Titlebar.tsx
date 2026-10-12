import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useRightRail } from '../right-rail/RightRailContext';
import { OpenRailIcon, FocusModeIcon, VoiceIcon } from '../right-rail/icons';
import { useRailTabs } from '../right-rail/tabs';
import ThemeToggle from '../themes/ThemeToggle';

interface TitlebarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onToggleSidebar?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  editor?: Editor | null;
  /** Toggle for the format toolbar. Always in the titlebar, left of the Voice
   *  heatmap, rail open or closed. */
  onToggleToolbar?: () => void;
  toolbarOpen?: boolean;
  /** Focus mode toggle. The titlebar renders it only when the rail is
   *  closed; the rail topbar owns it when open. */
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
  /** Voice heatmap (human vs agent). Always in the titlebar, left of the plugin
   *  toggles (the chat), rail open or closed. adr: adr/document-history-attribution.md */
  heatmapOn?: boolean;
  onToggleHeatmap?: () => void;
  heatmapAvailable?: boolean;
  heatmapTitle?: string;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateCommand: string;
}

/**
 * Titlebar. After the 2026-05-23 right-rail refactor, this is intentionally
 * lean: navigation, undo/redo, title, update badge.
 *
 * Right side of the titlebar:
 *   - always: format-toolbar toggle, Voice heatmap, plugin toggles (the chat)
 *     — controls for the document, so they never move
 *   - rail CLOSED also: Focus, light/dark, OpenRail (the rail topbar holds
 *     these while it is open)
 *
 * Sync stays inside the rail topbar — opening the rail is required to
 * trigger a sync, matching how the left sidebar gates search + tree.
 *
 * adr: adr/right-rail.md
 */
export default function Titlebar({ title, onTitleChange, onToggleSidebar, canGoBack, canGoForward, onGoBack, onGoForward, editor, onToggleToolbar, toolbarOpen, focusMode, onToggleFocusMode, heatmapOn, onToggleHeatmap, heatmapAvailable, heatmapTitle }: TitlebarProps) {
  const { visible: railVisible, openTab, activeTab, closeRail } = useRightRail();
  const toggleTabs = useRailTabs().filter((t) => t.titlebarToggle);
  const [editing, setEditing] = useState(false);
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  // Check for updates on mount
  useEffect(() => {
    fetch('/api/update-info')
      .then(r => r.json())
      .then(data => {
        if (data.updateAvailable) {
          setUpdateInfo({
            currentVersion: data.currentVersion,
            latestVersion: data.updateAvailable,
            updateCommand: data.updateCommand || 'npm update -g openwriter',
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleDoubleClick = useCallback(() => {
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, []);

  const handleBlur = useCallback(() => {
    setEditing(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setEditing(false);
    }
    if (e.key === 'Escape') {
      setEditing(false);
    }
  }, []);

  // Re-render when editor state changes so undo/redo disabled states update
  useEffect(() => {
    if (!editor) return;
    const onTransaction = () => setTick((n) => n + 1);
    editor.on('transaction', onTransaction);
    return () => { editor.off('transaction', onTransaction); };
  }, [editor]);

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        {onToggleSidebar && (
          <button className="titlebar-menu-btn" onClick={onToggleSidebar} title="Open sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
              <path d="M9 3v18" stroke="currentColor" strokeWidth="2" />
              <path d="M14 10l2 2-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onGoBack && (
          <button className="titlebar-nav-btn" onClick={onGoBack} disabled={!canGoBack} title="Go back (Alt+Left)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onGoForward && (
          <button className="titlebar-nav-btn" onClick={onGoForward} disabled={!canGoForward} title="Go forward (Alt+Right)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {editor && (
          <>
            <div className="titlebar-divider" />
            <button
              className="titlebar-nav-btn"
              onClick={() => editor.chain().focus().undo().run()}
              disabled={!editor.can().undo()}
              title="Undo (Ctrl+Z)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M3 10h10a5 5 0 0 1 0 10H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M7 6L3 10l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              className="titlebar-nav-btn"
              onClick={() => editor.chain().focus().redo().run()}
              disabled={!editor.can().redo()}
              title="Redo (Ctrl+Y)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M21 10H11a5 5 0 0 0 0 10h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M17 6l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
      </div>
      <div className="titlebar-center">
        {editing ? (
          <input
            ref={inputRef}
            className="titlebar-input"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
          />
        ) : (
          <span className="titlebar-title" onDoubleClick={handleDoubleClick}>
            {title}
          </span>
        )}
        {updateInfo && (
          <span
            className="titlebar-update-badge"
            title={`Update available: v${updateInfo.currentVersion} → v${updateInfo.latestVersion}\nRun: ${updateInfo.updateCommand}`}
          >
            v{updateInfo.latestVersion}
          </span>
        )}
      </div>
      <div className="titlebar-right">
        {focusMode && <div id="focus-review-controls" />}
        {onToggleToolbar && (
          <button
            className={`titlebar-nav-btn${toolbarOpen ? ' titlebar-nav-btn--active' : ''}`}
            onClick={onToggleToolbar}
            title="Toggle format toolbar"
            aria-label="Toggle format toolbar"
            aria-pressed={toolbarOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 20h16" />
              <path d="m6 16 6-12 6 12" />
              <path d="M8 12h8" />
            </svg>
          </button>
        )}
        {heatmapAvailable && onToggleHeatmap && (
          <button
            className={`titlebar-nav-btn${heatmapOn ? ' titlebar-nav-btn--active' : ''}`}
            onClick={onToggleHeatmap}
            title={heatmapTitle}
            aria-label="Voice heatmap (human vs agent)"
            aria-pressed={heatmapOn}
          >
            <VoiceIcon />
          </button>
        )}
        {/* Plugin tabs that asked for a titlebar toggle: always here, rail open or closed. */}
        {toggleTabs.map((tab) => {
          const showing = railVisible && activeTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`titlebar-nav-btn${showing ? ' titlebar-nav-btn--active' : ''}`}
              onClick={() => (showing ? closeRail() : openTab(tab.id))}
              title={showing ? `Close ${tab.label}` : tab.label}
              aria-label={showing ? `Close ${tab.label}` : `Open ${tab.label}`}
              aria-pressed={showing}
            >
              {tab.icon}
            </button>
          );
        })}
        {!railVisible && onToggleFocusMode && (
          <button
            className={`titlebar-nav-btn${focusMode ? ' titlebar-nav-btn--active' : ''}`}
            onClick={onToggleFocusMode}
            title="Focus mode"
            aria-label="Focus mode"
            aria-pressed={focusMode}
          >
            <FocusModeIcon />
          </button>
        )}
        {!railVisible && <ThemeToggle className="titlebar-nav-btn" />}
        {!railVisible && (
          <button
            className="titlebar-nav-btn"
            onClick={() => openTab(activeTab || 'activity')}
            title="Show right rail"
            aria-label="Show right rail"
          >
            <OpenRailIcon />
          </button>
        )}
      </div>
    </div>
  );
}
