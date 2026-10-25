/**
 * Publish the open document: the same choices as the phone's publish sheet (when, who can read,
 * free up to here, email), plus Preview, a test email to yourself and a secret link, all from a
 * draft saved on the site first. The button says exactly what happens ("Publish and email 2,580
 * subscribers"), asks once more, then says what happened so nobody sends twice.
 */
import { useEffect, useMemo, useState } from 'react';
import { owApi, useApp } from '../bridge';
import { pickPhoto, uploadPhoto } from '../photos';
import { host, run, setSiteKey, useSiteKey } from '../api';
import { go } from '../nav';
import PreviewDialog from '../PreviewDialog';
import { placeWall, publishedText, recipients, wallChoices, type Counts } from '../publish-model';
import { AuthorPicker } from '../Authors';
import ClaimName from '../ClaimName';
import { useSite } from '../SiteApp';
import { ActionBtn, Btn, Empty, Field, Notice, Page, Section, Tabs, Toggle } from '../ui';
import { showToast } from '../toast';

export default function Publish() {
  const { info } = useSite();
  const app = useApp();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [when, setWhen] = useState<'now' | 'schedule'>('now');
  const [at, setAt] = useState('');
  const [audience, setAudience] = useState<'everyone' | 'paid'>('everyone');
  const [email, setEmail] = useState(true);
  const [freePreview, setFreePreview] = useState(true);
  const [cover, setCover] = useState<string | null>(null);
  const [subjectB, setSubjectB] = useState('');
  const [abWait, setAbWait] = useState(60);
  const [seoDescription, setSeoDescription] = useState('');
  const [socialImage, setSocialImage] = useState<string | null>(null);
  const [authors, setAuthors] = useState<string[] | null>(null);
  const [step, setStep] = useState<'edit' | 'confirm' | 'busy'>('edit');
  const [result, setResult] = useState<{ text: string; url?: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, bump] = useState(0);
  const posted = app.metadata?.sitePost as { id?: string; status?: string; url?: string; site?: string } | undefined;
  const key = useSiteKey();
  // A document is one post on one site: publishing it from another site would make a second post there.
  useEffect(() => { if (posted?.id && (posted.site ?? null) !== key) setSiteKey(posted.site ?? null); }, [posted?.id, posted?.site, key]);
  const paidPart = /\[paid-only\]/i.test(app.editor?.getText?.() || '');
  const live = posted?.status === 'published' || posted?.status === 'scheduled';

  useEffect(() => { run<Counts>('get_subscriber_counts').then(setCounts).catch(() => setCounts(null)); }, []);
  useEffect(() => { if (posted?.status === 'published') setEmail(false); }, [posted?.status]);
  useEffect(() => { setResult(null); setStep('edit'); setAuthors(null); }, [app.filename]);

  const wall = useMemo(() => wallChoices(app.editor), [app.editor, audience, step]);
  const n = recipients(counts, audience);
  const sends = email && n !== null && n > 0;
  const people = n === null ? 'subscribers' : `${n.toLocaleString()} subscriber${n === 1 ? '' : 's'}`;
  const verb = live ? 'Update' : when === 'schedule' ? 'Schedule' : 'Publish';
  const label = sends ? `${verb} and email ${people}` : live ? 'Update the post' : verb;

  if (!app.filename) return <Page title="Publish"><Empty>Open a document first, then come back here to publish it.</Empty></Page>;
  // No address yet: choose it here; once claimed, the publish form for this document follows.
  if (!info.address) {
    return (
      <Page title={`Publish "${app.title || 'Untitled'}"`} sub="First, your site needs an address.">
        <ClaimName />
      </Page>
    );
  }

  /** Save the document as a draft on the site (unless it is already live), so it can be previewed. */
  const saveDraft = async (): Promise<boolean> => {
    if (live) return true;
    setSaving(true);
    owApi().app.flush();
    try {
      await run('publish_to_site', { draft: true, audience, ...(cover ? { cover_url: cover } : {}), ...(authors ? { authors } : {}) });
      return true;
    } catch (err: any) {
      showToast(err?.message || 'The draft did not save.', 'error', 8000);
      return false;
    } finally { setSaving(false); }
  };

  const chooseCover = async () => {
    const file = await pickPhoto();
    if (!file) return;
    try { setCover(await uploadPhoto(file)); } catch (err: any) { showToast(err?.message || 'The picture did not upload.', 'error'); }
  };

  const publish = async () => {
    setStep('busy');
    owApi().app.flush();
    try {
      const r = await run<{ url?: string; status?: string; email?: string; publish_at?: string }>('publish_to_site', {
        audience,
        ...(when === 'schedule' && at ? { publish_at: new Date(at).toISOString() } : {}),
        ...(cover ? { cover_url: cover } : {}),
        ...(sends ? { send_email: true } : {}),
        ...(sends && audience === 'paid' ? { send_free_preview: freePreview } : {}),
        ...(sends && subjectB.trim() ? { subject_b: subjectB.trim(), ab_test_wait_minutes: abWait } : {}),
        ...(seoDescription.trim() ? { seo_description: seoDescription.trim() } : {}),
        ...(socialImage ? { social_image_url: socialImage } : {}),
        ...(authors ? { authors } : {}),
      });
      setResult({ text: publishedText(r, at, live), url: r.url });
    } catch (err: any) {
      setStep('edit');
      showToast(err?.message || 'Publishing failed.', 'error', 8000);
    }
  };

  if (result) {
    return (
      <Page title="Publish">
        <Notice>{result.text}{result.url && <> · <a href={result.url} target="_blank" rel="noopener noreferrer">View post</a></>}</Notice>
        <div className="ows-actions"><Btn onClick={() => go('posts')}>See all posts</Btn></div>
      </Page>
    );
  }

  return (
    <Page title={`Publish "${app.title || 'Untitled'}"`} sub={`To ${host(info.address)}`}>
      <Section>
        <div className="ows-cover-row">
          <button type="button" className={`ows-cover${cover ? ' ows-cover--set' : ''}`} onClick={() => void chooseCover()}
            style={cover ? { backgroundImage: `url(${cover})` } : undefined} aria-label={cover ? 'Change the cover picture' : 'Add a cover picture'}>
            {!cover && 'Add a cover'}
          </button>
          <div className="ows-sub">The cover shows at the top of the post, in the email, and when the link is shared.</div>
        </div>
        <AuthorPicker key={app.filename} postId={posted?.id} onChange={setAuthors} />
        <Field label="When">
          <Tabs label="When" value={when} onChange={setWhen} options={[{ value: 'now', label: 'Now' }, { value: 'schedule', label: 'Schedule' }]} />
        </Field>
        {when === 'schedule' && (
          <Field label="Date and time"><input className="ows-input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
        )}
        <Field label="Who can read it">
          <Tabs label="Who can read it" value={audience} onChange={setAudience} options={[{ value: 'everyone', label: 'Everyone' }, { value: 'paid', label: 'Paid subscribers' }]} />
        </Field>
        {paidPart && audience === 'everyone' && <Notice>This post has a part for paid subscribers only. Everyone else reads the rest, without that part.</Notice>}
        {audience === 'paid' && (
          <Field label="Free up to here" hint="Readers without a plan see this much, then an invitation to subscribe.">
            <select className="ows-input" value={wall.current === null ? '' : String(wall.current)}
              onChange={(e) => { placeWall(app.editor, e.target.value === '' ? null : Number(e.target.value)); bump((x) => x + 1); }}>
              <option value="">Title only</option>
              {wall.blocks.map((b, i) => (
                <option key={b.index} value={String(i + 1)}>After paragraph {i + 1}: {b.text.length > 48 ? `${b.text.slice(0, 48)}...` : b.text}</option>
              ))}
            </select>
          </Field>
        )}
        <Toggle label="Email it to subscribers" checked={email} onChange={setEmail}
          hint={`${n === null ? '' : `${n.toLocaleString()} ${n === 1 ? 'person' : 'people'}`}${posted?.status === 'published' ? ' · a post already emailed is not sent again' : ''}`} />
        {email && audience === 'paid' && (
          <Toggle label="Also email free subscribers the free part" checked={freePreview} onChange={setFreePreview}
            hint="They get everything above the paywall and an invitation to upgrade." />
        )}
      </Section>

      <Section title="Subject and sharing">
        {email && (
          <>
            <Field label="Test a second subject (optional)"
              hint={`The title is subject A. 20% of the list gets one of the two; the subject opened more goes to everyone else. Needs 200 or more recipients${n !== null && n < 200 ? `; you have ${n}` : ''}.`}>
              <input className="ows-input" value={subjectB} onChange={(e) => setSubjectB(e.target.value)} disabled={n !== null && n < 200} />
            </Field>
            {subjectB.trim() && (
              <Field label="Pick the winner after">
                <select className="ows-input ows-select-sm" value={abWait} onChange={(e) => setAbWait(Number(e.target.value))}>
                  <option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option><option value={240}>4 hours</option>
                </select>
              </Field>
            )}
          </>
        )}
        <Field label="Description for search and sharing (optional)" hint="Shown under the title in search results and link previews. Defaults to the subtitle.">
          <textarea className="ows-input" rows={2} maxLength={300} value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} />
        </Field>
        <div className="ows-field">
          <span className="ows-field-label">Picture for link previews (optional)</span>
          <div className="ows-pic-row">
            {socialImage && <img className="ows-pic" src={socialImage} alt="" />}
            <Btn onClick={async () => {
              const file = await pickPhoto();
              if (!file) return;
              try { setSocialImage(await uploadPhoto(file)); } catch (err: any) { showToast(err?.message || 'The picture did not upload.', 'error'); }
            }}>{socialImage ? 'Change' : 'Choose a picture'}</Btn>
            {socialImage && <Btn kind="quiet" onClick={() => setSocialImage(null)}>Use the cover</Btn>}
          </div>
          <span className="ows-field-hint">Defaults to the cover.</span>
        </div>
      </Section>

      <Section title="Before you send">
        <p className="ows-sub">{live ? 'Preview shows the post as readers see it now.' : 'Saves a draft on your site first. Readers see nothing until you publish.'}</p>
        <div className="ows-actions">
          <Btn disabled={saving} onClick={async () => { if (await saveDraft()) setPreviewing(true); }}>{saving ? 'Saving the draft...' : 'Preview'}</Btn>
          <ActionBtn label="Send a test email to me" doing="Sending..."
            run={async () => { if (!(await saveDraft())) throw new Error('The draft did not save.'); return run('send_test_email', { as: audience === 'paid' ? 'paid' : 'free' }); }}
            done={(r) => `Test email sent to ${r?.sent_to || 'you'}.`} />
          {!live && (
            <ActionBtn label="Copy a secret link" doing="Making the link..."
              run={async () => {
                if (!(await saveDraft())) throw new Error('The draft did not save.');
                const r = await run<{ url: string }>('get_post_share_link');
                await navigator.clipboard?.writeText(r.url).catch(() => {});
                return r;
              }}
              done={(r) => `Copied. Anyone with the link can read this draft: ${r.url}`} />
          )}
        </div>
      </Section>

      <div className="ows-publish-bar">
        {step === 'edit' && <Btn kind="primary" disabled={when === 'schedule' && !at} onClick={() => setStep('confirm')}>{label}</Btn>}
        {step === 'confirm' && (
          <span className="ows-confirm">
            <span className="ows-confirm-q">{label}?{sends ? ' A post is emailed once and cannot be recalled.' : ''}</span>
            <Btn kind="primary" onClick={() => void publish()}>Yes, {verb.toLowerCase()}</Btn>
            <Btn kind="quiet" onClick={() => setStep('edit')}>Cancel</Btn>
          </span>
        )}
        {step === 'busy' && <Btn kind="primary" disabled>{sends ? 'Publishing and sending...' : 'Publishing...'}</Btn>}
      </div>
      {previewing && <PreviewDialog title={app.title || 'Untitled'} paid={audience === 'paid'} onClose={() => setPreviewing(false)} />}
    </Page>
  );
}
