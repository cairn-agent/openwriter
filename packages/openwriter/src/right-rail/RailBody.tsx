/**
 * Rail body — bottom slot of the right rail column, occupying everything
 * below the icon strip. Renders the active tab's component. Width and
 * resize handle are owned by the parent <RightRail>; the body is just a
 * fill element.
 *
 * adr: adr/right-rail.md
 */
import { useRightRail } from './RightRailContext';
import { useLayoutEffect, useState } from 'react';
import ReviewTab from './tabs/ReviewTab';
import { findTab, useRailTabs } from './tabs';
import type { RightRailTabProps } from './types';

interface RailBodyProps extends RightRailTabProps { railVisible: boolean }

export default function RailBody({ railVisible, ...props }: RailBodyProps) {
  const { activeTab } = useRightRail();
  const active = findTab(activeTab, useRailTabs());
  // The Review tab on screen holds the review controls; otherwise (another tab such as the
  // chat holds the rail, the rail is closed, or Focus) they float over the bottom of the document.
  const floating = !(railVisible && activeTab === 'review');
  // Only a slot that is shown gets the controls. A page that hides it (an embedder's own
  // review on a small screen) mounts no second controller to fight over the current change.
  const [floatTarget, setFloatTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!floating) { setFloatTarget(null); return; }
    const pick = () => {
      const slot = document.getElementById('floating-review');
      setFloatTarget(slot && slot.getClientRects().length > 0 ? slot : null);
    };
    pick();
    const watch = new MutationObserver(pick);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', pick);
    return () => { watch.disconnect(); window.removeEventListener('resize', pick); };
  }, [floating]);

  return (
    <div className="rail-body" role="tabpanel">
      {activeTab === 'review'
        ? !floating && <ReviewTab {...props} />
        : active ? <active.Component {...props} /> : null}
      {floatTarget && <ReviewTab {...props} floatingTarget={floatTarget} />}
    </div>
  );
}
