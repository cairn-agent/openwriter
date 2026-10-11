/**
 * Chat tab: the rail's frame around the chat panel. "N changes proposed" opens
 * that document's pending changes in Review.
 * adr: adr/right-rail.md
 * adr: adr/writer-key-ai.md
 */
import ChatPanel from '../../ai/ChatPanel';
import { useRightRail } from '../RightRailContext';
import type { RightRailTabProps } from '../types';

export default function ChatTab({ docId, currentFilename, onSwitchDocument }: RightRailTabProps) {
  const { openTab } = useRightRail();
  return (
    <ChatPanel
      docId={docId}
      onOpenReview={(filename) => {
        if (filename && filename !== currentFilename) onSwitchDocument(filename);
        openTab('review');
      }}
    />
  );
}
