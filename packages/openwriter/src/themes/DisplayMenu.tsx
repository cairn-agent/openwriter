/**
 * The "Aa" button at the end of the format bar: type style and canvas.
 * The style is the one the writer's site and its emails use (site-type-style.ts);
 * the canvas changes how the editor looks to this writer only. adr: adr/right-rail.md
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TYPE_STYLES, CANVAS_STYLES, updateAppearance } from './appearance-store';
import type { TypeStyle } from './appearance-store';
import { useAppearance } from './useAppearance';
import { followSiteTypeStyle, setSiteTypeStyle, type SiteTypeStyle } from './site-type-style';
import Popover from './Popover';

export default function DisplayMenu() {
  const { typeStyle, canvas } = useAppearance();
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState<SiteTypeStyle | null>(null);
  const [failed, setFailed] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    followSiteTypeStyle().then(setSite).catch(() => setSite(null));
  }, [open]);

  const pickStyle = async (style: TypeStyle) => {
    const before = typeStyle;
    updateAppearance({ typeStyle: style });
    if (!site) return;
    if (await setSiteTypeStyle(style)) {
      setSite({ ...site, style });
    } else {
      updateAppearance({ typeStyle: before });
      setFailed(true);
    }
  };

  const locked = !!site && !site.canChange;
  const styleNote = failed
    ? 'Could not change your site. Try again.'
    : locked
      ? 'Set by your site\'s owner'
      : site
        ? 'Your site and its emails use this too'
        : null;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`format-toolbar__btn format-toolbar__btn--text${open ? ' active' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((o) => !o)}
        title="Type style and canvas"
        aria-label="Editor display"
        aria-expanded={open}
      >
        Aa
      </button>
      {open && (
        <Popover anchor={anchor} onClose={close} label="Editor display">
          <div className="appearance-menu-head">
            <span className="appearance-menu-title">Editor display</span>
          </div>

          <div className="appearance-section">
            <div className="appearance-section-title">Style</div>
            <div className="appearance-grid appearance-grid--3">
              {TYPE_STYLES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`appearance-option appearance-option--type-${t.id}${typeStyle === t.id ? ' active' : ''}`}
                  onClick={() => pickStyle(t.id)}
                  disabled={locked}
                  title={t.description}
                  aria-pressed={typeStyle === t.id}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {styleNote && <div className="appearance-menu-note">{styleNote}</div>}
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
            <div className="appearance-menu-note">Only you see this</div>
          </div>
        </Popover>
      )}
    </>
  );
}
