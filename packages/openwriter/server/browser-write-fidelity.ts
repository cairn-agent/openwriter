/** Browser snapshot fidelity policy, shared by every browser write boundary.
 * adr: adr/browser-write-fidelity.md */
import type { PadDocument } from './state.js';

export function wouldCollapseBody(current: PadDocument | null | undefined, incoming: PadDocument | null | undefined): boolean {
  const currentNodes = current?.content?.length ?? 0;
  const incomingNodes = incoming?.content?.length ?? 0;
  return currentNodes > 5 && incomingNodes < currentNodes * 0.3;
}
