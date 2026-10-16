import { useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { useRightRail } from '../right-rail/RightRailContext';
import { showModified } from '../decorations/review-actions';
import { getPreviewNodeId } from '../decorations/plugin';
import OutlineView from './OutlineView';

/** Both presentations share one mounted PadEditor and one history/save stream.
 * adr: adr/outline-editor.md */
export default function OutlineSurface({ children, onModeChange, ...props }: {
  children: ReactNode; editor: Editor | null; docId: string; filename: string;
  title: string; connected: boolean; onOpenSource: (filename: string) => void;
  beforeBuild: () => Promise<void>;
  onModeChange: (text: boolean) => void;
}) {
  const [text, setText] = useState(false);
  const { openTab } = useRightRail();
  const changeMode = (next: boolean) => {
    if (!next && props.editor) showModified(props.editor, getPreviewNodeId());
    setText(next); onModeChange(next);
  };
  return <div className="outline-surface">
    <div className="outline-view-switch" role="group" aria-label="Outline view">
      <button type="button" aria-pressed={!text} onClick={() => changeMode(false)}>Outline</button>
      <button type="button" aria-pressed={text} onClick={() => changeMode(true)}>Text</button>
    </div>
    <div hidden={text}><OutlineView {...props} onReview={() => { changeMode(true); openTab('review'); }} /></div>
    <div hidden={!text}>{children}</div>
  </div>;
}
