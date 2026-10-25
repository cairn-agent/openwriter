/**
 * The editor's type style follows the writer's published site: on start the editor takes the
 * site's style, and picking one in the Aa menu sets the site's too, so the editor, the site and its
 * emails always share one style. Without a site the style is this editor's own.
 * adr: adr/type-styles.md
 */
import { TYPE_STYLES, updateAppearance, type TypeStyle } from './appearance-store';

export interface SiteTypeStyle {
  style: TypeStyle;
  /** Owners and admins can change it; a contributor's editor only follows it. */
  canChange: boolean;
}

async function callTool(tool: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch('/api/mcp-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, arguments: args }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.content?.[0]?.text;
  try {
    return text ? JSON.parse(text) : data;
  } catch {
    return null;
  }
}

/** The site's style, applied to the editor. Null when there is no site (or no connection). */
export async function followSiteTypeStyle(): Promise<SiteTypeStyle | null> {
  const result = await callTool('get_site', {}).catch(() => null);
  const style = result?.site?.settings?.type_style;
  if (!TYPE_STYLES.some((t) => t.id === style)) return null;
  updateAppearance({ typeStyle: style });
  return { style, canChange: result.role === 'owner' || result.role === 'admin' };
}

/** Sets the site's style; true when the site took it. */
export async function setSiteTypeStyle(style: TypeStyle): Promise<boolean> {
  const result = await callTool('update_site_settings', { type_style: style }).catch(() => null);
  return !!result?.success;
}
