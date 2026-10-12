/**
 * Light/dark switch. Sits in the right rail's top bar while the rail is open
 * and in the title bar while it is closed, like the format-bar toggle, so it
 * is reachable in Focus mode. adr: adr/right-rail.md
 */
import { updateAppearance } from './appearance-store';
import { useAppearance } from './useAppearance';

export default function ThemeToggle({ className }: { className: string }) {
  const { mode } = useAppearance();
  const next = mode === 'light' ? 'dark' : 'light';
  const label = mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
  return (
    <button type="button" className={className} onClick={() => updateAppearance({ mode: next })} title={label} aria-label={label}>
      {mode === 'light' ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
      )}
    </button>
  );
}
