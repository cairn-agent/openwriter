/**
 * Newsletter Compose View — card-based newsletter editing.
 *
 * Layout: subject line → preview text → body (inside outlined card).
 * Matches blog/article compose view conventions.
 */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import SchedulePostModal from '../sidebar/SchedulePostModal';
import { useUiText } from '../plugins/client-plugins';
import './NewsletterComposeView.css';

// ─── Types ──────────────────────────────────────────────────────

export interface NewsletterContext {
  active?: boolean;
  subject?: string;
  previewText?: string;
  lastSend?: { sentCount: number; sentAt: string; issueId?: string };
}

// ─── Metadata persistence ───────────────────────────────────────

function saveNewsletterMeta(partial: Partial<NewsletterContext>) {
  fetch('/api/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newsletterContext: partial }),
  }).catch(() => {});
}

// ─── Newsletter Compose View ────────────────────────────────────

interface NewsletterConnection {
  id: string;
  provider: string;
  display_name: string;
  status: string;
}

interface NewsletterComposeViewProps {
  children: ReactNode;
  newsletterContext?: NewsletterContext;
  filename?: string;
  title?: string;
  onTitleChange?: (title: string) => void;
}

export function TextNewsletterView({ children, newsletterContext, filename, title, onTitleChange }: NewsletterComposeViewProps) {
  const ctx = newsletterContext || {};
  const [subject, setSubject] = useState(ctx.subject || '');
  const [previewText, setPreviewText] = useState(ctx.previewText || '');
  const [connections, setConnections] = useState<NewsletterConnection[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const publishHint = useUiText('newsletter.publishHint', 'To email your readers, ask your agent to publish this to your site.');
  // Sends made with the retired old newsletter send, kept in the doc's metadata.
  const lastSend = ctx.lastSend?.sentAt ? ctx.lastSend : null;
  // Track last subject value we auto-synced to the title
  const autoSyncedSubject = useRef<string | null>(null);
  const prevFilename = useRef(filename);
  // Track last values WE saved, so we can detect external changes (e.g. agent set_metadata)
  const lastSavedSubject = useRef(ctx.subject || '');
  const lastSavedPreview = useRef(ctx.previewText || '');

  // Sync state from context on document switch OR external metadata change
  useEffect(() => {
    if (prevFilename.current !== filename) {
      // Document switch — full reset
      setSubject(ctx.subject || '');
      setPreviewText(ctx.previewText || '');
      lastSavedSubject.current = ctx.subject || '';
      lastSavedPreview.current = ctx.previewText || '';
      prevFilename.current = filename;
    } else {
      // Same doc — only sync if the value changed externally (not from our own save)
      const incomingSubject = ctx.subject || '';
      const incomingPreview = ctx.previewText || '';
      if (incomingSubject !== lastSavedSubject.current) {
        setSubject(incomingSubject);
        lastSavedSubject.current = incomingSubject;
      }
      if (incomingPreview !== lastSavedPreview.current) {
        setPreviewText(incomingPreview);
        lastSavedPreview.current = incomingPreview;
      }
    }
  }, [newsletterContext, filename]);

  // A connected publish platform can email this doc as a site post
  useEffect(() => {
    fetch('/api/connections')
      .then(r => r.json())
      .then(data => {
        const conns = (data.connections || []).filter((c: any) => c.provider === 'newsletter' && c.status === 'active');
        setConnections(conns);
      })
      .catch(() => {});
  }, []);

  const canSave = !!newsletterContext?.active;

  // Debounced auto-sync: subject → title after 500ms of no typing
  const syncTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    if (!onTitleChange || !subject.trim()) return;
    syncTimer.current = setTimeout(async () => {
      const cur = title;
      const isUntitled = !cur || cur === 'Untitled';
      const wasAutoSynced = autoSyncedSubject.current !== null && cur === autoSyncedSubject.current;
      if (isUntitled || wasAutoSynced) {
        // Await metadata save so server has subject before title-update triggers file promotion
        try {
          await fetch('/api/metadata', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newsletterContext: { subject } }),
          });
        } catch {}
        onTitleChange(subject.trim());
        autoSyncedSubject.current = subject.trim();
      }
    }, 500);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [subject, title, onTitleChange]);

  const saveFields = useCallback(() => {
    if (canSave) {
      lastSavedSubject.current = subject;
      lastSavedPreview.current = previewText;
      saveNewsletterMeta({ subject, previewText });
    }
  }, [canSave, subject, previewText]);

  const previewCharCount = previewText.length;
  const previewFull = previewCharCount >= 90;
  const previewOverLimit = previewCharCount > 150;

  return (
    <div className="nl-compose-wrapper">
      {lastSend && (
        <div className="nl-sent-status">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Sent {new Date(lastSend.sentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} to {lastSend.sentCount} subscriber{lastSend.sentCount !== 1 ? 's' : ''}
        </div>
      )}
      <div className="nl-compose-content">
        <input
          className="nl-subject-input"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onBlur={saveFields}
          placeholder="Subject line (defaults to title if empty)"
          autoComplete="off"
          data-lpignore="true"
          data-1p-ignore
          spellCheck={false}
        />
        <div className="nl-preview-wrap">
          <textarea
            className={`nl-preview-input${previewOverLimit ? ' over-limit' : ''}`}
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            onBlur={saveFields}
            placeholder="Preview text shown in inbox before opening..."
            rows={2}
            spellCheck={false}
          />
          <span className={`nl-preview-count${previewOverLimit ? ' over-limit' : previewFull ? ' full' : ''}`}>
            {previewCharCount}/90
          </span>
        </div>
        <div className="nl-compose-body">{children}</div>
      </div>

      {filename && (
        <div className="nl-compose-footer">
          {connections.length > 0 && publishHint && (
            <span className="nl-footer-hint">{publishHint}</span>
          )}
          <button className="nl-footer-btn" onClick={() => setShowScheduleModal(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            Schedule
          </button>
        </div>
      )}

      {showScheduleModal && filename && (
        <SchedulePostModal
          filename={filename}
          title={title || 'Untitled'}
          onClose={() => setShowScheduleModal(false)}
        />
      )}
    </div>
  );
}
