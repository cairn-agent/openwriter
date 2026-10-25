/** The three type styles a published site uses (type-styles.css), so the editor shows what readers get. */
export type TypeStyle = 'classic' | 'editorial' | 'modern';
export type ThemeMode = 'light' | 'dark';
export type SidebarMode = 'timeline' | 'board' | 'files';
export type SidebarDensity = 'full' | 'compact' | 'minimal';
export type CanvasStyle = 'seamless' | 'outline' | 'page' | 'paper';

export const TYPE_STYLES: { id: TypeStyle; label: string; description: string }[] = [
  { id: 'classic', label: 'Classic', description: 'Source Serif throughout' },
  { id: 'editorial', label: 'Editorial', description: 'Playfair Display titles, Newsreader text' },
  { id: 'modern', label: 'Modern', description: 'Inter throughout' },
];

export const SIDEBAR_MODES: { id: SidebarMode; label: string; icon: string }[] = [
  { id: 'files', label: 'Files', icon: 'files' },
  { id: 'timeline', label: 'Timeline', icon: 'timeline' },
  { id: 'board', label: 'Board', icon: 'board' },
];

export const CANVAS_STYLES: { id: CanvasStyle; label: string }[] = [
  { id: 'seamless', label: 'Seamless' },
  { id: 'outline', label: 'Outline' },
  { id: 'page', label: 'Page' },
  { id: 'paper', label: 'Paper' },
];

const SIDEBAR_DENSITIES: SidebarDensity[] = ['full', 'compact', 'minimal'];

const KEYS = {
  typeStyle: 'ow-type-style',
  mode: 'ow-theme-mode',
  sidebarMode: 'ow-sidebar-mode',
  sidebarDensity: 'ow-sidebar-density',
  canvas: 'ow-canvas',
} as const;

// The nine typefaces before the type styles: the sans ones become modern, the rest classic.
const SANS_TYPEFACES = ['inter', 'grotesk', 'dm-sans'];

function migrateIfNeeded(): void {
  const oldTypeface = localStorage.getItem('ow-typeface');
  if (oldTypeface && !localStorage.getItem(KEYS.typeStyle)) {
    localStorage.setItem(KEYS.typeStyle, SANS_TYPEFACES.includes(oldTypeface) ? 'modern' : 'classic');
  }
  for (const stale of ['ow-typeface', 'ow-spacing', 'ow-typography', 'ow-theme', 'ow-color', 'ow-sidebar-style']) {
    localStorage.removeItem(stale);
  }
}

export function getTypeStyle(): TypeStyle {
  const stored = localStorage.getItem(KEYS.typeStyle);
  if (stored && TYPE_STYLES.some(t => t.id === stored)) return stored as TypeStyle;
  return 'classic';
}

export function getMode(): ThemeMode {
  const stored = localStorage.getItem(KEYS.mode);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function getSidebarMode(): SidebarMode {
  const stored = localStorage.getItem(KEYS.sidebarMode);
  if (stored && SIDEBAR_MODES.some(m => m.id === stored)) return stored as SidebarMode;
  return 'files';
}

export function getSidebarDensity(): SidebarDensity {
  const stored = localStorage.getItem(KEYS.sidebarDensity);
  if (stored && SIDEBAR_DENSITIES.includes(stored as SidebarDensity)) return stored as SidebarDensity;
  return 'full';
}

export function setSidebarDensity(density: SidebarDensity): void {
  localStorage.setItem(KEYS.sidebarDensity, density);
  document.documentElement.setAttribute('data-sidebar-density', density);
}

export function getCanvasStyle(): CanvasStyle {
  const stored = localStorage.getItem(KEYS.canvas);
  if (stored && CANVAS_STYLES.some(c => c.id === stored)) return stored as CanvasStyle;
  return 'seamless';
}

export function applyAppearance(
  typeStyle: TypeStyle,
  mode: ThemeMode,
  sidebarMode: SidebarMode,
  canvas: CanvasStyle = 'seamless',
): void {
  const el = document.documentElement;
  el.setAttribute('data-type-style', typeStyle);
  el.setAttribute('data-mode', mode);
  el.setAttribute('data-sidebar-mode', sidebarMode);
  if (canvas === 'seamless') {
    el.removeAttribute('data-canvas');
  } else {
    el.setAttribute('data-canvas', canvas);
  }
  localStorage.setItem(KEYS.typeStyle, typeStyle);
  localStorage.setItem(KEYS.mode, mode);
  localStorage.setItem(KEYS.sidebarMode, sidebarMode);
  localStorage.setItem(KEYS.canvas, canvas);
}

/** Fired on window after any appearance change, so every control showing a setting re-reads it. */
export const APPEARANCE_CHANGE_EVENT = 'ow-appearance-change';

/** Change some settings and keep the rest. */
export function updateAppearance(patch: Partial<{
  typeStyle: TypeStyle; mode: ThemeMode; sidebarMode: SidebarMode; canvas: CanvasStyle;
}>): void {
  applyAppearance(
    patch.typeStyle ?? getTypeStyle(),
    patch.mode ?? getMode(),
    patch.sidebarMode ?? getSidebarMode(),
    patch.canvas ?? getCanvasStyle(),
  );
  if (patch.sidebarMode) window.dispatchEvent(new CustomEvent('ow-sidebar-mode-change', { detail: patch.sidebarMode }));
  window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}

export function initAppearance(): void {
  migrateIfNeeded();
  applyAppearance(getTypeStyle(), getMode(), getSidebarMode(), getCanvasStyle());
  document.documentElement.setAttribute('data-sidebar-density', getSidebarDensity());
}
