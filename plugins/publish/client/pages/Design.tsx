/**
 * Settings > Design: the accent colour, type style, wordmark, homepage layout and links, and
 * tracking (Google Analytics or Plausible, and asking AI crawlers not to train on the site).
 */
import { useState } from 'react';
import { pickPhoto, uploadPhoto } from '../photos';
import { run } from '../api';
import { useSite } from '../SiteApp';
import { ActionBtn, Btn, Field, Section, Toggle } from '../ui';
import { showToast } from '../toast';

const TYPE_STYLES: Array<[string, string, string]> = [
  ['classic', 'Classic', 'Source Serif for titles and text'],
  ['editorial', 'Editorial', 'Playfair Display titles, Newsreader text'],
  ['modern', 'Modern', 'Inter for titles and text'],
];
const LAYOUTS: Array<[string, string, string]> = [
  ['magazine', 'Magazine', 'A featured post, then tiles and rows'],
  ['list', 'List', 'Every post as a row, beside the sidebar'],
  ['grid', 'Grid', 'Every post as a picture tile, three across'],
];

interface Link { label: string; url: string }

function Links({ title, hint, value, onChange }: { title: string; hint: string; value: Link[]; onChange: (v: Link[]) => void }) {
  const set = (i: number, patch: Partial<Link>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="ows-field">
      <span className="ows-field-label">{title}</span>
      <span className="ows-field-hint">{hint}</span>
      {value.map((l, i) => (
        <div className="ows-inline" key={i}>
          <input className="ows-input" placeholder="Label" maxLength={40} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          <input className="ows-input" placeholder="https://... or /about" value={l.url} onChange={(e) => set(i, { url: e.target.value })} />
          <Btn kind="quiet" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Btn>
        </div>
      ))}
      {value.length < 6 && <div><Btn onClick={() => onChange([...value, { label: '', url: '' }])}>Add a link</Btn></div>}
    </div>
  );
}

function Picture({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ows-field">
      <span className="ows-field-label">{label}</span>
      <div className="ows-pic-row">
        {value && <img className="ows-pic ows-pic--wordmark" src={value} alt="" />}
        <Btn onClick={async () => {
          const file = await pickPhoto();
          if (!file) return;
          try { onChange(await uploadPhoto(file)); } catch (err: any) { showToast(err?.message || 'The picture did not upload.', 'error'); }
        }}>{value ? 'Change' : 'Choose a picture'}</Btn>
        {value && <Btn kind="quiet" onClick={() => onChange('')}>Remove</Btn>}
      </div>
      <span className="ows-field-hint">{hint}</span>
    </div>
  );
}

export default function Design() {
  const { info, refresh } = useSite();
  const st = info.site?.settings || {};
  const [accent, setAccent] = useState<string>(st.accent_color || '');
  const [typeStyle, setTypeStyle] = useState<string>(st.type_style || 'classic');
  const [wordmark, setWordmark] = useState<string>(st.wordmark_url || '');
  const [wordmarkDark, setWordmarkDark] = useState<string>(st.wordmark_dark_url || '');
  const [layout, setLayout] = useState<string>(st.home_layout || 'magazine');
  const [nav, setNav] = useState<Link[]>(st.nav_links || []);
  const [home, setHome] = useState<Link[]>(st.home_links || []);
  const [ga, setGa] = useState<string>(st.google_analytics_id || '');
  const [plausible, setPlausible] = useState<string>(st.plausible_domain || '');

  const clean = (l: Link[]) => l.filter((x) => x.label.trim() && x.url.trim()).map((x) => ({ label: x.label.trim(), url: x.url.trim() }));
  const toggleAi = async (v: boolean) => {
    try { await run('update_site_settings', { block_ai_training: v }); refresh(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
  };

  return (
    <>
      <Section title="Look">
        <div className="ows-grid2">
          <Field label="Accent colour" hint="Buttons and links on your site and in emails. Adjusted per theme so it stays readable.">
            <span className="ows-inline">
              <input type="color" className="ows-color" value={accent || '#2563eb'} onChange={(e) => setAccent(e.target.value)} aria-label="Accent colour" />
              {accent && <Btn kind="quiet" onClick={() => setAccent('')}>Default</Btn>}
            </span>
          </Field>
        </div>
        <div className="ows-field">
          <span className="ows-field-label">Type</span>
          <span className="ows-field-hint">Your site, its emails and your editor all use this.</span>
          <div className="ows-choices" role="radiogroup" aria-label="Type style">
            {TYPE_STYLES.map(([v, l, d]) => (
              <button key={v} type="button" role="radio" aria-checked={typeStyle === v} className={`ows-choice${typeStyle === v ? ' ows-choice--on' : ''}`} onClick={() => setTypeStyle(v)}>
                <strong>{l}</strong><span>{d}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ows-grid2">
          <Picture label="Wordmark" hint="A picture of your publication's name, shown instead of the name in type. A transparent PNG or SVG drawn for a light page." value={wordmark} onChange={setWordmark} />
          <Picture label="Wordmark for dark mode" hint="Light lettering. Without it, dark mode shows the name in type." value={wordmarkDark} onChange={setWordmarkDark} />
        </div>
        <div className="ows-field">
          <span className="ows-field-label">Homepage</span>
          <div className="ows-choices" role="radiogroup" aria-label="Homepage layout">
            {LAYOUTS.map(([v, l, d]) => (
              <button key={v} type="button" role="radio" aria-checked={layout === v} className={`ows-choice${layout === v ? ' ows-choice--on' : ''}`} onClick={() => setLayout(v)}>
                <strong>{l}</strong><span>{d}</span>
              </button>
            ))}
          </div>
        </div>
        <Links title="Links in the menu" hint="Up to 6, after your sections." value={nav} onChange={setNav} />
        <Links title="Links on the homepage" hint="Up to 6, under the subscribe box: your social profiles, a shop, a podcast." value={home} onChange={setHome} />
        <ActionBtn kind="primary" label="Save design" doing="Saving..."
          run={() => run('update_site_settings', {
            accent_color: accent, type_style: typeStyle, wordmark_url: wordmark, wordmark_dark_url: wordmarkDark,
            home_layout: layout, nav_links: clean(nav), home_links: clean(home),
          })}
          done={() => { refresh(); return 'Saved. Your site shows the new design within a few minutes.'; }} />
      </Section>

      <Section title="Tracking and search">
        <div className="ows-grid2">
          <Field label="Google Analytics measurement ID" hint="Like G-ABC123DEF4. Added to your site's pages only, never to emails.">
            <input className="ows-input" value={ga} onChange={(e) => setGa(e.target.value.trim())} />
          </Field>
          <Field label="Plausible domain" hint="The domain your site is registered under in Plausible.">
            <input className="ows-input" value={plausible} onChange={(e) => setPlausible(e.target.value.trim())} />
          </Field>
        </div>
        <ActionBtn label="Save tracking" doing="Saving..." run={() => run('update_site_settings', { google_analytics_id: ga, plausible_domain: plausible })}
          done={() => { refresh(); return ga || plausible ? 'Saved. The tag is on your pages within a few minutes.' : 'Tracking removed.'; }} />
        <Toggle label="Ask AI companies not to train on my site" checked={!!st.block_ai_training} onChange={(v) => void toggleAi(v)}
          hint="Tells AI training crawlers to stay away (robots.txt, ai.txt and page tags). Search engines and AI search still find you." />
      </Section>
    </>
  );
}
