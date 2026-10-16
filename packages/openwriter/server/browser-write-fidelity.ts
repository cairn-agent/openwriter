/** Browser snapshot fidelity policy, shared by every browser write boundary.
 * adr: adr/browser-write-fidelity.md */
import type { PadDocument } from './state.js';

export function wouldCollapseBody(current: PadDocument | null | undefined, incoming: PadDocument | null | undefined, removedOutlineIds: readonly string[] = []): boolean {
  const currentNodes = current?.content?.length ?? 0;
  const incomingNodes = incoming?.content?.length ?? 0;
  if (!(currentNodes > 5 && incomingNodes < currentNodes * 0.3)) return false;
  // The outline editor records the exact block identities removed by a human
  // transaction. Every disappearing block must be accounted for; a blank
  // snapshot without that evidence still fails closed.
  const retained = new Set((incoming?.content || []).map(n => n.attrs?.id).filter(Boolean));
  const removed = new Set(removedOutlineIds);
  return (current?.content || []).some(n => !retained.has(n.attrs?.id) && (!n.attrs?.id || !removed.has(n.attrs.id)));
}
