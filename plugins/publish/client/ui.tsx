/**
 * The site dashboard's few building blocks, in OpenWriter's colours (its theme variables), so
 * every page reads the same: a page with a title, sections, numbers, rows with actions, tabs,
 * fields, and buttons that say what they do while they do it.
 */
import { useState, type ReactNode } from 'react';
import { showToast } from './toast';

export function Page({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="ows-page">
      <div className="ows-page-head">
        <div>
          <h1 className="ows-h1">{title}</h1>
          {sub && <p className="ows-sub">{sub}</p>}
        </div>
        {actions && <div className="ows-page-actions">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="ows-section">
      {(title || aside) && (
        <div className="ows-section-head">
          {title && <h2 className="ows-h2">{title}</h2>}
          {aside && <div className="ows-section-aside">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="ows-stats">{children}</div>;
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="ows-stat">
      <div className="ows-stat-value">{value}</div>
      <div className="ows-stat-label">{label}</div>
      {sub && <div className="ows-stat-sub">{sub}</div>}
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  return <div className={`ows-notice ows-notice--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ows-empty">{children}</div>;
}

export function Loading({ what }: { what: string }) {
  return <div className="ows-empty" aria-busy="true">Loading {what}...</div>;
}

export function Failed({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <Notice kind="error">
      {error}
      {retry && <> <button type="button" className="ows-link" onClick={retry}>Try again</button></>}
    </Notice>
  );
}

type Kind = 'primary' | 'secondary' | 'danger' | 'quiet';

export function Btn({ kind = 'secondary', onClick, disabled, children, title, type = 'button' }: {
  kind?: Kind; onClick?: () => void; disabled?: boolean; children: ReactNode; title?: string; type?: 'button' | 'submit';
}) {
  return (
    <button type={type} className={`ows-btn ows-btn--${kind}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

/**
 * A button that runs an action, says what it is doing while it runs ("Sending..."), and toasts
 * the result. With `confirm`, the first press asks once, naming the object, before anything happens.
 */
export function ActionBtn({ kind = 'secondary', label, doing, confirm, yes, run, done, disabled }: {
  kind?: Kind;
  label: ReactNode;
  doing: string;
  confirm?: ReactNode;
  yes?: string;
  run: () => Promise<unknown>;
  done?: (result: any) => string | null | void;
  disabled?: boolean;
}) {
  const [step, setStep] = useState<'idle' | 'ask' | 'busy'>('idle');
  const go = async () => {
    setStep('busy');
    try {
      const r = await run();
      const msg = done?.(r);
      if (msg) showToast(msg, 'info');
    } catch (err: any) {
      showToast(err?.message || 'That did not work.', 'error', 8000);
    } finally {
      setStep('idle');
    }
  };
  if (step === 'busy') return <button type="button" className={`ows-btn ows-btn--${kind}`} disabled>{doing}</button>;
  if (step === 'ask') {
    return (
      <span className="ows-confirm" role="group">
        <span className="ows-confirm-q">{confirm}</span>
        <button type="button" className={`ows-btn ows-btn--${kind === 'secondary' || kind === 'quiet' ? 'primary' : kind}`} onClick={() => void go()} autoFocus>{yes || 'Yes'}</button>
        <button type="button" className="ows-btn ows-btn--quiet" onClick={() => setStep('idle')}>Cancel</button>
      </span>
    );
  }
  return (
    <button type="button" className={`ows-btn ows-btn--${kind}`} disabled={disabled} onClick={() => (confirm ? setStep('ask') : void go())}>
      {label}
    </button>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="ows-tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value}
          className={`ows-tab${o.value === value ? ' ows-tab--on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="ows-rows">{children}</div>;
}

export function Row({ title, meta, aside, actions, onOpen }: {
  title: ReactNode; meta?: ReactNode; aside?: ReactNode; actions?: ReactNode; onOpen?: () => void;
}) {
  return (
    <div className="ows-row">
      <div className="ows-row-main">
        {onOpen
          ? <button type="button" className="ows-row-title ows-row-title--btn" onClick={onOpen}>{title}</button>
          : <div className="ows-row-title">{title}</div>}
        {meta && <div className="ows-row-meta">{meta}</div>}
      </div>
      {aside && <div className="ows-row-aside">{aside}</div>}
      {actions && <div className="ows-row-actions">{actions}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="ows-field">
      <span className="ows-field-label">{label}</span>
      {children}
      {hint && <span className="ows-field-hint">{hint}</span>}
    </label>
  );
}

export function Toggle({ label, hint, checked, onChange, disabled }: {
  label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <label className="ows-toggle">
      <span className="ows-toggle-text">
        <span className="ows-field-label">{label}</span>
        {hint && <span className="ows-field-hint">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="ows-switch" aria-hidden="true" />
    </label>
  );
}

/** A small modal for one focused job (preview, a form), closed by Esc, the backdrop or Close. */
export function Dialog({ title, onClose, wide, children, footer }: {
  title: string; onClose: () => void; wide?: boolean; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <div className="ows-dialog-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className={`ows-dialog${wide ? ' ows-dialog--wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ows-dialog-head">
          <h2 className="ows-h2">{title}</h2>
          <button type="button" className="ows-btn ows-btn--quiet" onClick={onClose} autoFocus>Close</button>
        </div>
        <div className="ows-dialog-body">{children}</div>
        {footer && <div className="ows-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
