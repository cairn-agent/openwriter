/**
 * The right-click "Insert block" panel: post blocks (paid-only part, callout, poll, file...)
 * written into the document as the markers the publishing server reads (blocks.ts).
 */
import { useState } from 'react';
import type { MenuPanelContext } from '@openwriter-src/plugins/client-plugins';
import { showToast } from './toast';
import { BLOCKS, insertBlock, openSurveys, type BlockId } from './blocks';

export function pickFile(accept = '.pdf,.epub,.zip,.csv,.txt,.docx,.xlsx,.pptx'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    const done = (f: File | null) => { if (!settled) { settled = true; input.remove(); resolve(f); } };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

export default function InsertBlockPanel({ ctx }: { ctx: MenuPanelContext }) {
  const [busy, setBusy] = useState<BlockId | null>(null);
  const [surveys, setSurveys] = useState<Array<{ slug: string; title: string }> | null>(null);
  const choose = async (id: BlockId, survey?: string) => {
    if (id === 'survey' && !survey) {
      setBusy(id);
      try { setSurveys(await openSurveys()); } catch (err: any) { showToast(err?.message || 'Your surveys did not load.', 'error', 8000); }
      setBusy(null);
      return;
    }
    setBusy(id);
    try {
      const msg = await insertBlock(id, ctx.editor, ctx.selection, () => pickFile(), survey);
      ctx.close();
      if (msg) showToast(msg, 'info', 6000);
    } catch (err: any) {
      showToast(err?.message || 'That did not work.', 'error', 8000);
      setBusy(null);
    }
  };
  if (surveys) {
    return (
      <div className="ows-blocks" role="menu" aria-label="Choose a survey">
        {surveys.map((s) => (
          <button key={s.slug} type="button" role="menuitem" className="ows-block-item" disabled={busy !== null} onClick={() => void choose('survey', s.slug)}>
            <span className="ows-block-label">{s.title}</span>
          </button>
        ))}
        <p className="ows-block-note">{surveys.length ? 'Pick the survey this post shows.' : 'No open surveys. Make one on Your site, Surveys.'}</p>
      </div>
    );
  }
  return (
    <div className="ows-blocks" role="menu" aria-label="Insert block">
      {BLOCKS.map((b) => (
        <button key={b.id} type="button" role="menuitem" className="ows-block-item" disabled={busy !== null} onClick={() => void choose(b.id)}>
          <span className="ows-block-label">{busy === b.id ? (b.id === 'file' ? 'Uploading...' : b.id === 'survey' ? 'Loading...' : 'Adding...') : b.label}</span>
          <span className="ows-block-hint">{b.hint}</span>
        </button>
      ))}
      <p className="ows-block-note">Blocks show on your site and in emails when you publish.</p>
    </div>
  );
}
