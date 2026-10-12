/**
 * The "Aa" button at the end of the format bar: typeface, spacing and canvas.
 * These change how the editor looks to this writer only, never a published
 * post. adr: adr/right-rail.md
 */
import { useCallback, useRef, useState } from 'react';
import { TYPEFACES, SPACING_PRESETS, CANVAS_STYLES, updateAppearance } from './appearance-store';
import type { SpacingPreset } from './appearance-store';
import { useAppearance } from './useAppearance';
import Popover from './Popover';

/** Line height and heading size (as a multiple of body text) for each spacing, drawn as a sketch. */
const SPACING_SHAPE: Record<SpacingPreset, { lead: number; heading: number; name: string }> = {
  default: { lead: 1.8, heading: 1.9, name: 'Standard' },
  web: { lead: 1.75, heading: 2.25, name: 'Airy, large headings' },
  blog: { lead: 1.6, heading: 2, name: 'Newsletter' },
  butterick: { lead: 1.4, heading: 1.28, name: 'Tight, small headings' },
};

function SpacingSketch({ id }: { id: SpacingPreset }) {
  const { lead, heading } = SPACING_SHAPE[id];
  const gap = lead * 3.2;
  const top = 4 + heading * 2.4;
  const lines = [0, 1, 2, 3].map((i) => top + 3 + i * gap + (i >= 2 ? gap * 0.5 : 0));
  return (
    <svg width="44" height="34" viewBox="0 0 44 34" aria-hidden="true">
      <rect x="4" y="4" width="22" height={heading * 1.6} rx="1" fill="currentColor" />
      {lines.map((y, i) => (
        <rect key={i} x="4" y={y} width={i % 2 ? 30 : 36} height="1.6" rx="0.8" fill="currentColor" opacity="0.55" />
      ))}
    </svg>
  );
}

export default function DisplayMenu() {
  const { typeface, spacing, canvas } = useAppearance();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`format-toolbar__btn format-toolbar__btn--text${open ? ' active' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title="Editor display: typeface, spacing, canvas"
        aria-label="Editor display"
        aria-expanded={open}
      >
        Aa
      </button>
      {open && (
        <Popover anchor={anchor} onClose={close} label="Editor display">
          <div className="appearance-menu-head">
            <span className="appearance-menu-title">Editor display</span>
            <span className="appearance-menu-note">Only you see this</span>
          </div>

          <div className="appearance-section">
            <div className="appearance-section-title">Typeface</div>
            <div className="appearance-grid appearance-grid--3">
              {TYPEFACES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`appearance-option${typeface === t.id ? ' active' : ''}`}
                  onClick={() => updateAppearance({ typeface: t.id })}
                  title={t.description}
                  aria-pressed={typeface === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="appearance-section">
            <div className="appearance-section-title">Spacing</div>
            <div className="appearance-grid appearance-grid--4">
              {SPACING_PRESETS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`appearance-option appearance-option--sketch${spacing === s.id ? ' active' : ''}`}
                  onClick={() => updateAppearance({ spacing: s.id })}
                  title={SPACING_SHAPE[s.id].name}
                  aria-label={SPACING_SHAPE[s.id].name}
                  aria-pressed={spacing === s.id}
                >
                  <SpacingSketch id={s.id} />
                </button>
              ))}
            </div>
          </div>

          <div className="appearance-section">
            <div className="appearance-section-title">Canvas</div>
            <div className="appearance-grid appearance-grid--4">
              {CANVAS_STYLES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`appearance-option${canvas === c.id ? ' active' : ''}`}
                  onClick={() => updateAppearance({ canvas: c.id })}
                  aria-pressed={canvas === c.id}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
