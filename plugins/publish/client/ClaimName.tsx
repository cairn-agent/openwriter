/**
 * Naming the site and choosing its address (<name>.openwriter.io), wherever a site without one is
 * first met: Home, and Publish, which then goes straight on to publishing the open document.
 * The address follows the name until the writer edits it.
 */
import { useState } from 'react';
import { run, slugInput } from './api';
import { useSite } from './SiteApp';
import { ActionBtn, Field, Section } from './ui';

export default function ClaimName() {
  const { refresh } = useSite();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const fromTitle = (t: string) => slugInput(t.trim()).replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
  return (
    <Section title="Name your site">
      <p className="ows-sub">Readers see this name on your site and in their inbox. You can change both later.</p>
      <Field label="Site name">
        <input className="ows-input" value={title} placeholder="The Morning Page" autoFocus
          onChange={(e) => { setTitle(e.target.value); if (!slugEdited) setSlug(fromTitle(e.target.value)); }} />
      </Field>
      <Field label="Address">
        <span className="ows-suffix">
          <input className="ows-input" value={slug} placeholder="the-morning-page" autoCapitalize="none"
            onChange={(e) => { setSlugEdited(true); setSlug(slugInput(e.target.value)); }} />
          <span>.openwriter.io</span>
        </span>
      </Field>
      <ActionBtn kind="primary" label="Create my site" doing="Creating..." disabled={!title.trim() || slug.length < 3}
        run={() => run('claim_site_name', { name: slug, title: title.trim() })}
        done={() => { refresh(); return `Your site is ${slug}.openwriter.io.`; }} />
    </Section>
  );
}
