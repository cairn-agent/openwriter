/**
 * A small menu anchored under a button. It renders on the page body, so a bar
 * that scrolls or clips (the format bar) never cuts it off, and closes on a
 * click outside it, Escape or a window resize.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import './appearance.css';

export default function Popover({ anchor, onClose, label, children }: {
  anchor: RefObject<HTMLElement>;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Below the button, kept inside the window.
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const width = el.offsetWidth;
    const left = Math.max(8, Math.min(a.left + a.width / 2 - width / 2, window.innerWidth - width - 8));
    setPos({ top: a.bottom + 6, left });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
      anchor.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Its place was measured once; a resize would leave it detached from the button.
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ow-popover"
      role="dialog"
      aria-label={label}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
