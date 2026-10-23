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
  const [floatTarget, setFloatTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setFloatTarget(floating ? document.getElementById('floating-review') : null);
  }, [floating]);

  return (
    <div className="rail-body" role="tabpanel">
      {activeTab === 'review'
        ? !floating && <ReviewTab {...props} />
        : active ? <active.Component {...props} /> : null}
      {floating && <ReviewTab {...props} floatingTarget={floatTarget} />}
    </div>
  );
}
