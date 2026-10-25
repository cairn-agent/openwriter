/**
 * Settings: the site (name, tagline, about, terms and privacy, pictures, address), publication
 * rules and reader switches, the welcome emails, the custom domain, the team and guest authors,
 * and sections and tags. Each form saves only what changed.
 */
import { useEffect, useState } from 'react';
import { pickPhoto, uploadPhoto } from '../photos';
import { day, host, run, slugInput, useTool } from '../api';
import { GuestAuthors } from '../Authors';
import { useSite } from '../SiteApp';
import { ActionBtn, Btn, Empty, Failed, Field, Loading, Notice, Page, Row, Rows, Section, Tabs, Toggle } from '../ui';
import { showToast } from '../toast';
import Account from './Account';
import Design from './Design';
import EmailSettings from './EmailSettings';

type View = 'site' | 'design' | 'publication' | 'emails' | 'domain' | 'team' | 'sections' | 'account';

/** The about page is stored as HTML; the writer edits plain paragraphs. */
function htmlToText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = Array.from(doc.body.children);
  if (!blocks.length) return doc.body.textContent || '';
  return blocks.map((b) => (b.textContent || '').trim()).filter(Boolean).join('\n\n');
}
function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

/** Only the fields that differ from what was loaded. */
function changed(now: Record<string, any>, was: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(now).filter(([k, v]) => (v ?? '') !== (was[k] ?? '')));
}

function SiteDetails() {
  const { info, refresh } = useSite();
  const s = info.site || {};
  const was = {
    name: s.name ?? '', tagline: s.tagline ?? '', about: htmlToText(s.about ?? ''), logo_url: s.logo_url ?? '', cover_url: s.cover_url ?? '',
    terms: htmlToText(s.terms ?? ''), privacy: htmlToText(s.privacy ?? ''),
  };
  const [f, setF] = useState(was);
  const [slug, setSlug] = useState(s.slug ?? '');
  const diff = changed(f, was);
  const picture = async (key: 'logo_url' | 'cover_url') => {
    const file = await pickPhoto();
    if (!file) return;
    try { const url = await uploadPhoto(file); setF((x) => ({ ...x, [key]: url })); } catch (err: any) { showToast(err?.message || 'The picture did not upload.', 'error'); }
  };
  return (
    <>
      <Section title="Site">
        <Field label="Name"><input className="ows-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Tagline" hint="One line under the name."><input className="ows-input" value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></Field>
        <Field label="About" hint="Shown on your About page. A blank line starts a new paragraph.">
          <textarea className="ows-input" rows={6} value={f.about} onChange={(e) => setF({ ...f, about: e.target.value })} />
        </Field>
        <Field label="Terms of use (optional)" hint="Your own rules for readers. When filled in, the footer links to a Terms page; leave it empty for no page.">
          <textarea className="ows-input" rows={4} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} />
        </Field>
        <Field label="Privacy policy (optional)" hint="When filled in, the footer links to a Privacy page.">
          <textarea className="ows-input" rows={4} value={f.privacy} onChange={(e) => setF({ ...f, privacy: e.target.value })} />
        </Field>
        <div className="ows-grid2">
          <div className="ows-field">
            <span className="ows-field-label">Logo</span>
            <div className="ows-pic-row">
              {f.logo_url && <img className="ows-pic ows-pic--logo" src={f.logo_url} alt="" />}
              <Btn onClick={() => void picture('logo_url')}>{f.logo_url ? 'Change' : 'Add a logo'}</Btn>
              {f.logo_url && <Btn kind="quiet" onClick={() => setF({ ...f, logo_url: '' })}>Remove</Btn>}
            </div>
          </div>
          <div className="ows-field">
            <span className="ows-field-label">Cover</span>
            <div className="ows-pic-row">
              {f.cover_url && <img className="ows-pic" src={f.cover_url} alt="" />}
              <Btn onClick={() => void picture('cover_url')}>{f.cover_url ? 'Change' : 'Add a cover'}</Btn>
              {f.cover_url && <Btn kind="quiet" onClick={() => setF({ ...f, cover_url: '' })}>Remove</Btn>}
            </div>
          </div>
        </div>
        <ActionBtn kind="primary" label="Save" doing="Saving..." disabled={!Object.keys(diff).length}
          run={() => run('update_site', {
            ...diff,
            ...Object.fromEntries((['about', 'terms', 'privacy'] as const).filter((k) => diff[k] !== undefined).map((k) => [k, textToHtml(diff[k])])),
          })}
          done={() => { refresh(); return 'Saved. Your site shows it within a few minutes.'; }} />
      </Section>
      {info.role === 'owner' && (
        <Section title="Address">
          <Field label="Your site's address" hint={`Changing it breaks links to ${host(info.address)} that people already have.`}>
            <span className="ows-suffix"><input className="ows-input" value={slug} onChange={(e) => setSlug(slugInput(e.target.value))} /><span>.openwriter.io</span></span>
          </Field>
          <ActionBtn label="Change address" doing="Changing..." disabled={slug.length < 3 || slug === s.slug}
            confirm={`Move your site to ${slug}.openwriter.io? Old links to ${host(info.address)} stop working.`} yes="Change it"
            run={() => run('claim_site_name', { name: slug })} done={() => { refresh(); return `Your site is now ${slug}.openwriter.io.`; }} />
        </Section>
      )}
    </>
  );
}

function Publication() {
  const { info, refresh } = useSite();
  const st = info.site?.settings || {};
  const was = {
    author_name: st.author_name ?? '', mailing_address: st.mailing_address ?? '', default_audience: st.default_audience ?? 'everyone',
    auto_wall_after_days: String(st.auto_wall_after_days ?? 0), language: st.language ?? 'en',
  };
  const [f, setF] = useState(was);
  const toggle = async (key: string, v: boolean) => {
    try { await run('update_site_settings', { [key]: v }); refresh(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
  };
  const diff = changed(f, was);
  return (
    <>
      <Section title="Publication">
        <Field label="Your name as the author"><input className="ows-input" value={f.author_name} onChange={(e) => setF({ ...f, author_name: e.target.value })} /></Field>
        <Field label="Mailing address" hint="Printed at the bottom of every email, as anti-spam law requires. A PO box is fine.">
          <textarea className="ows-input" rows={2} value={f.mailing_address} onChange={(e) => setF({ ...f, mailing_address: e.target.value })} />
        </Field>
        <div className="ows-grid2">
          <Field label="New posts are for">
            <select className="ows-input" value={f.default_audience} onChange={(e) => setF({ ...f, default_audience: e.target.value })}>
              <option value="everyone">Everyone</option><option value="subscribers">Subscribers</option><option value="paid">Paid subscribers</option><option value="founding">Founding members</option>
            </select>
          </Field>
          <Field label="Old posts become paid-only after (days)" hint="0 keeps them free.">
            <input className="ows-input" inputMode="numeric" value={f.auto_wall_after_days} onChange={(e) => setF({ ...f, auto_wall_after_days: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
        <Field label="Language of your writing" hint="Dates on your site and in emails follow it, and readers' browsers offer to translate from it.">
          <select className="ows-input" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
            {(LANGUAGES.some(([v]) => v === f.language) ? LANGUAGES : [[f.language, f.language], ...LANGUAGES]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <ActionBtn kind="primary" label="Save" doing="Saving..." disabled={!Object.keys(diff).length}
          run={() => run('update_site_settings', { ...diff, ...(diff.auto_wall_after_days !== undefined ? { auto_wall_after_days: Number(diff.auto_wall_after_days) } : {}) })}
          done={() => { refresh(); return 'Saved.'; }} />
      </Section>
      <Section title="Readers">
        <Toggle label="New subscribers confirm by email" hint="Keeps fake and mistyped addresses off your list." checked={!!st.double_opt_in} onChange={(v) => void toggle('double_opt_in', v)} />
        <Toggle label="Welcome page for first-time visitors" hint="A subscribe page before the homepage." checked={!!st.welcome_page} onChange={(v) => void toggle('welcome_page', v)} />
        <Toggle label="Comments on new posts" checked={st.comments_enabled !== false} onChange={(v) => void toggle('comments_enabled', v)} />
        <Toggle label="Private site" hint="Only approved subscribers can read; readers ask to join and you approve them on Subscribers." checked={!!st.private} onChange={(v) => void toggle('private', v)} />
        {st.private && <Toggle label="Email me when someone asks to join" checked={!!st.notify_subscribe_requests} onChange={(v) => void toggle('notify_subscribe_requests', v)} />}
        <Toggle label="Readers can add a picture to a comment" hint="One picture per comment. Deleting the comment deletes the picture." checked={!!st.comment_images} onChange={(v) => void toggle('comment_images', v)} />
        <Toggle label="Show likes on posts" checked={st.show_likes !== false} onChange={(v) => void toggle('show_likes', v)} />
        <Toggle label="Show author names on posts" hint="Off shows your site's name instead." checked={st.show_bylines !== false} onChange={(v) => void toggle('show_bylines', v)} />
        <Toggle label="Other sites can cross-post your posts" hint="They link to your post and you keep the credit and the comments." checked={st.allow_cross_posts !== false} onChange={(v) => void toggle('allow_cross_posts', v)} />
      </Section>
    </>
  );
}

const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-BR', 'Portuguese (Brazil)'],
  ['nl', 'Dutch'], ['sv', 'Swedish'], ['da', 'Danish'], ['nb', 'Norwegian'], ['fi', 'Finnish'], ['pl', 'Polish'], ['cs', 'Czech'], ['tr', 'Turkish'],
  ['ru', 'Russian'], ['uk', 'Ukrainian'], ['el', 'Greek'], ['he', 'Hebrew'], ['ar', 'Arabic'], ['hi', 'Hindi'], ['id', 'Indonesian'], ['vi', 'Vietnamese'],
  ['th', 'Thai'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh-CN', 'Chinese (Simplified)'], ['zh-TW', 'Chinese (Traditional)'],
];

function Domain() {
  const d = useTool<{ domain: any }>('get_site_domain');
  const [hostname, setHostname] = useState('');
  if (d.loading && !d.data) return <Loading what="your domain" />;
  if (d.error) return <Failed error={d.error} retry={d.reload} />;
  const dom = d.data?.domain;
  if (!dom) {
    return (
      <Section title="Use your own domain">
        <p className="ows-sub">Your site can live at your own address, such as www.yourname.com. A subdomain like www is the easiest to set up.</p>
        <Field label="Domain"><input className="ows-input" placeholder="www.yourname.com" value={hostname} onChange={(e) => setHostname(e.target.value.trim().toLowerCase())} /></Field>
        <ActionBtn kind="primary" label="Add domain" doing="Adding..." disabled={!hostname.includes('.')}
          run={() => run('set_site_domain', { hostname: hostname.replace(/^https?:\/\//, '').replace(/\/.*$/, '') })} done={() => { d.reload(); return 'Added. Now add the DNS records below where you bought the domain.'; }} />
      </Section>
    );
  }
  const live = dom.status === 'active';
  return (
    <Section title={dom.hostname} aside={
      <ActionBtn kind="danger" label="Remove" doing="Removing..." confirm={`Remove ${dom.hostname}? Your site goes back to its openwriter.io address only.`} yes="Remove"
        run={() => run('remove_site_domain', { confirm: true })} done={() => { d.reload(); return `Removed ${dom.hostname}.`; }} />
    }>
      {live ? <Notice>Your site is live at {dom.hostname}.</Notice> : <Notice kind="warn">Waiting for DNS. Add these records where you bought the domain; it can take up to a day.</Notice>}
      {dom.errors?.length > 0 && <Notice kind="error">{dom.errors.join(' ')}</Notice>}
      {!live && dom.apex && <p className="ows-sub">This is a bare domain, so your DNS host must support a CNAME at the root (often called flattening or ALIAS).</p>}
      {!live && (
        <div className="ows-table-wrap">
          <table className="ows-table">
            <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
            <tbody>
              {(dom.records || []).map((r: any, i: number) => (
                <tr key={i}><td>{r.type}</td><td className="ows-mono">{r.name}</td><td className="ows-mono">{r.value ?? r.content}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!live && (
        <ActionBtn label="Check now" doing="Checking..." run={() => run('check_site_domain')}
          done={(r) => { d.reload(); return r?.domain?.status === 'active' ? 'Your site is live on your domain.' : 'Not yet. DNS changes can take a few hours.'; }} />
      )}
      {dom.last_checked_at && <p className="ows-sub">Last checked {day(dom.last_checked_at)}.</p>}
    </Section>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: 'Admin: runs the site, except its address, Stripe and the domain', contributor: 'Contributor: writes, publishes and emails posts', byline: 'Byline: named on posts, cannot sign in to the site' };

function Team() {
  const { info } = useSite();
  const team = useTool<{ owner: any; members: any[] }>('list_site_team');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('contributor');
  const [name, setName] = useState('');
  const isOwner = info.role === 'owner';
  const me = team.data?.members.find((m) => m.id === info.team_id);
  return (
    <>
      {info.role === 'admin' && me && (
        <Section title="Your emails">
          <Toggle label="Email me about new subscribers and cancellations" checked={!!me.notify}
            onChange={async (v) => { try { await run('update_team_member', { member_id: me.id, notify: v }); team.reload(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); } }} />
        </Section>
      )}
      {isOwner && (
        <Section title="Invite someone">
          <div className="ows-grid2">
            <Field label="Email"><input className="ows-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Name on posts (optional)"><input className="ows-input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
          <Field label="Role">
            <select className="ows-input" value={role} onChange={(e) => setRole(e.target.value)}>
              {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <ActionBtn kind="primary" label="Send invite" doing="Inviting..." disabled={!email.includes('@')}
            run={() => run('invite_to_team', { email: email.trim(), role, ...(name.trim() ? { name: name.trim() } : {}) })}
            done={(r) => {
              setEmail(''); setName(''); team.reload();
              if (r?.invite_link) void navigator.clipboard?.writeText(r.invite_link).catch(() => {});
              return `Invited ${email.trim()}. They get an email to join${r?.invite_link ? '; the link is copied too' : ''}.`;
            }} />
        </Section>
      )}
      <Section title="Team">
        {team.loading && !team.data && <Loading what="your team" />}
        {team.error && <Failed error={team.error} retry={team.reload} />}
        {team.data && (
          <Rows>
            <Row title={team.data.owner?.name || 'You'} meta="Owner" />
            {team.data.members.map((m) => (
              <Row key={m.id} title={m.name || m.invited_email}
                meta={[m.name ? m.invited_email : null, (ROLE_LABEL[m.role] || m.role).split(':')[0], m.accepted_at ? `joined ${day(m.accepted_at)}` : 'invited, not joined yet'].filter(Boolean).join(' · ')}
                actions={isOwner ? <>
                  <select className="ows-input ows-select-sm" aria-label={`Role for ${m.invited_email}`} value={m.role}
                    onChange={async (e) => { try { await run('update_team_member', { member_id: m.id, role: e.target.value }); team.reload(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); } }}>
                    {Object.keys(ROLE_LABEL).map((r) => <option key={r} value={r}>{ROLE_LABEL[r].split(':')[0]}</option>)}
                  </select>
                  <ActionBtn kind="danger" label="Remove" doing="Removing..." confirm={`Remove ${m.name || m.invited_email} from the team? Their posts stay up.`} yes="Remove"
                    run={() => run('remove_team_member', { member_id: m.id, confirm: true })} done={() => { team.reload(); return `Removed ${m.name || m.invited_email}.`; }} />
                </> : undefined} />
            ))}
          </Rows>
        )}
        {team.data && !team.data.members.length && <Empty>Just you. Invite an editor or a co-writer above.</Empty>}
      </Section>
      {info.role !== 'contributor' && <GuestAuthors />}
    </>
  );
}

function SectionsAndTags() {
  const sections = useTool<{ sections: any[] }>('list_site_sections');
  const tags = useTool<{ tags: any[] }>('list_site_tags');
  const [sName, setSName] = useState('');
  const [tName, setTName] = useState('');
  return (
    <>
      <Section title="Sections">
        <p className="ows-sub">A section is a separate newsletter inside your site, with its own page. Readers choose which sections they get.</p>
        {sections.error && <Failed error={sections.error} retry={sections.reload} />}
        {sections.data && (
          <Rows>
            {sections.data.sections.map((s) => (
              <Row key={s.id} title={s.name} meta={[s.description, s.show_in_nav ? 'In the menu' : null, s.hide_from_home ? 'Kept off the homepage' : null, s.add_new_by_default ? 'New subscribers get it' : 'Opt-in'].filter(Boolean).join(' · ')}
                actions={<>
                  <ActionBtn kind="quiet" label={s.show_in_nav ? 'Hide from menu' : 'Show in menu'} doing="Saving..."
                    run={() => run('save_site_section', { section_id: s.id, show_in_nav: !s.show_in_nav })} done={() => { sections.reload(); return 'Saved.'; }} />
                  <ActionBtn kind="quiet" label="Add all subscribers" doing="Adding..." confirm={`Add every current subscriber to ${s.name}? People who opted out stay out.`} yes="Add them"
                    run={() => run('add_subscribers_to_section', { section_id: s.id })} done={(r) => r?.message || 'Added.'} />
                  <ActionBtn kind="danger" label="Delete" doing="Deleting..." confirm={`Delete the section ${s.name}? Its posts move to your main publication.`} yes="Delete"
                    run={() => run('delete_site_section', { section_id: s.id, confirm: true })} done={() => { sections.reload(); return `Deleted ${s.name}.`; }} />
                </>} />
            ))}
          </Rows>
        )}
        <div className="ows-inline">
          <input className="ows-input" placeholder="New section name" value={sName} onChange={(e) => setSName(e.target.value)} />
          <ActionBtn label="Add section" doing="Adding..." disabled={!sName.trim()} run={() => run('save_site_section', { name: sName.trim() })}
            done={() => { setSName(''); sections.reload(); return 'Section added.'; }} />
        </div>
      </Section>
      <Section title="Tags">
        <p className="ows-sub">Tags group posts by topic; each tag gets a page listing its posts.</p>
        {tags.error && <Failed error={tags.error} retry={tags.reload} />}
        {tags.data && (
          <Rows>
            {tags.data.tags.map((t) => (
              <Row key={t.id} title={t.name} meta={t.show_in_nav ? 'In the menu' : undefined}
                actions={<>
                  <ActionBtn kind="quiet" label={t.show_in_nav ? 'Hide from menu' : 'Show in menu'} doing="Saving..."
                    run={() => run('save_site_tag', { tag_id: t.id, show_in_nav: !t.show_in_nav })} done={() => { tags.reload(); return 'Saved.'; }} />
                  <ActionBtn kind="danger" label="Delete" doing="Deleting..." confirm={`Delete the tag ${t.name}? It comes off every post.`} yes="Delete"
                    run={() => run('delete_site_tag', { tag_id: t.id, confirm: true })} done={() => { tags.reload(); return `Deleted ${t.name}.`; }} />
                </>} />
            ))}
          </Rows>
        )}
        <div className="ows-inline">
          <input className="ows-input" placeholder="New tag name" value={tName} onChange={(e) => setTName(e.target.value)} />
          <ActionBtn label="Add tag" doing="Adding..." disabled={!tName.trim()} run={() => run('save_site_tag', { name: tName.trim() })}
            done={() => { setTName(''); tags.reload(); return 'Tag added.'; }} />
        </div>
      </Section>
    </>
  );
}

export default function Settings() {
  const { info } = useSite();
  const manager = info.role !== 'contributor';
  const [view, setView] = useState<View>(manager ? 'site' : 'team');
  useEffect(() => { if (!manager) setView('team'); }, [manager]);
  const options: Array<{ value: View; label: string }> = manager
    ? [{ value: 'site', label: 'Site' }, { value: 'design', label: 'Design' }, { value: 'publication', label: 'Publication' }, { value: 'emails', label: 'Emails' },
       { value: 'domain', label: 'Domain' }, { value: 'team', label: 'Team' }, { value: 'sections', label: 'Sections and tags' }, { value: 'account', label: 'Account' }]
    : [{ value: 'team', label: 'Team' }, { value: 'account', label: 'Account' }];
  return (
    <Page title="Settings">
      <Tabs label="Settings" value={view} onChange={setView} options={options} />
      {view === 'site' && <SiteDetails />}
      {view === 'publication' && <Publication />}
      {view === 'design' && <Design />}
      {view === 'emails' && <EmailSettings />}
      {view === 'account' && <Account />}
      {view === 'domain' && <Domain />}
      {view === 'team' && <Team />}
      {view === 'sections' && <SectionsAndTags />}
    </Page>
  );
}
