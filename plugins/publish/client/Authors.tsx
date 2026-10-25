/**
 * Who a post is by: the "Written by" picker on Publish (you, team members, guest authors), and
 * the guest authors list on Settings, Team. A guest author has a name, a short bio, a photo and
 * a link, and their own page on the site; they never sign in.
 */
import { useEffect, useState } from 'react';
import { pickPhoto, uploadPhoto } from './photos';
import { count, run, useTool } from './api';
import { useSite } from './SiteApp';
import { ActionBtn, Btn, Dialog, Empty, Failed, Field, Loading, Row, Rows, Section } from './ui';
import { showToast } from './toast';

type Person = { id: string; name: string; note?: string };

/** Everyone who can be named on a post: the owner, accepted team members, guest authors. */
function usePeople(): Person[] | null {
  const team = useTool<{ owner: any; members: any[] }>('list_site_team');
  const guests = useTool<{ guest_authors: any[] }>('list_guest_authors');
  if (!team.data || !guests.data) return null;
  return [
    { id: 'owner', name: team.data.owner?.name || 'The owner' },
    ...team.data.members.filter((m) => m.accepted_at || m.role === 'byline').map((m) => ({ id: m.id, name: m.name || m.invited_email, note: 'team' })),
    ...guests.data.guest_authors.map((g) => ({ id: g.id, name: g.name, note: 'guest' })),
  ];
}

/**
 * The bylines for the post being published. Starts from the post's current authors when it is
 * already on the site, or from you. Reports null until the writer changes something, so an
 * untouched picker leaves the post's authors as they are.
 */
export function AuthorPicker({ postId, onChange }: { postId?: string; onChange: (ids: string[] | null) => void }) {
  const { info } = useSite();
  const people = usePeople();
  const [chosen, setChosen] = useState<string[] | null>(null);
  useEffect(() => {
    setChosen(null);
    const mine = [info.role === 'owner' ? 'owner' : info.team_id || 'owner'];
    if (!postId) { setChosen(mine); return; }
    run<{ posts: any[] }>('list_site_posts', { limit: 100 })
      .then((r) => setChosen(r.posts.find((p) => p.id === postId)?.authors?.map((a: any) => a.id) || mine))
      .catch(() => setChosen(mine));
  }, [postId, info.role, info.team_id]);
  if (!people || !chosen || people.length < 2) return null;
  const toggle = (id: string) => {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id].slice(0, 10);
    if (!next.length) return;
    setChosen(next);
    onChange(next);
  };
  return (
    <Field label="Written by" hint="Names show on the post in the order you pick them. Add guest authors on Settings, Team.">
      <div className="ows-tags">
        {people.map((p) => (
          <button key={p.id} type="button" className={`ows-pick${chosen.includes(p.id) ? ' ows-pick--on' : ''}`} aria-pressed={chosen.includes(p.id)} onClick={() => toggle(p.id)}>
            {p.name}{p.note === 'guest' ? ' (guest)' : ''}
          </button>
        ))}
      </div>
    </Field>
  );
}

type Guest = { id: string; name: string; bio?: string; photo_url?: string; link_url?: string; posts: number; url?: string };

function GuestForm({ guest, onClose, onSaved }: { guest: Guest | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: guest?.name ?? '', bio: guest?.bio ?? '', link_url: guest?.link_url ?? '', photo_url: guest?.photo_url ?? '' });
  const photo = async () => {
    const file = await pickPhoto();
    if (!file) return;
    try { const url = await uploadPhoto(file); setF((x) => ({ ...x, photo_url: url })); } catch (err: any) { showToast(err?.message || 'The picture did not upload.', 'error'); }
  };
  return (
    <Dialog title={guest ? `Edit ${guest.name}` : 'Add a guest author'} onClose={onClose}
      footer={<ActionBtn kind="primary" label="Save" doing="Saving..." disabled={!f.name.trim()}
        run={() => run('save_guest_author', { ...(guest ? { guest_author_id: guest.id } : {}), name: f.name.trim(), bio: f.bio.trim(), link_url: f.link_url.trim(), photo_url: f.photo_url })}
        done={(r) => { onSaved(); onClose(); return r?.message || 'Saved.'; }} />}>
      <Field label="Name"><input className="ows-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Short bio (optional)" hint="Shown under their name on their posts and their page.">
        <textarea className="ows-input" rows={3} maxLength={1000} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
      </Field>
      <Field label="Their website or profile (optional)"><input className="ows-input" placeholder="https://" value={f.link_url} onChange={(e) => setF({ ...f, link_url: e.target.value })} /></Field>
      <div className="ows-field">
        <span className="ows-field-label">Photo (optional)</span>
        <div className="ows-pic-row">
          {f.photo_url && <img className="ows-pic ows-pic--logo" src={f.photo_url} alt="" />}
          <Btn onClick={() => void photo()}>{f.photo_url ? 'Change' : 'Add a photo'}</Btn>
          {f.photo_url && <Btn kind="quiet" onClick={() => setF({ ...f, photo_url: '' })}>Remove</Btn>}
        </div>
      </div>
    </Dialog>
  );
}

/** Settings, Team: guest authors, for the owner and admins (contributors only see them on Publish). */
export function GuestAuthors() {
  const guests = useTool<{ guest_authors: Guest[] }>('list_guest_authors');
  const [editing, setEditing] = useState<Guest | null | 'new'>(null);
  return (
    <Section title="Guest authors" aside={<Btn onClick={() => setEditing('new')}>Add a guest author</Btn>}>
      <p className="ows-sub">Name someone outside your team on a post. They get a byline and their own page, and never need an account.</p>
      {guests.loading && !guests.data && <Loading what="guest authors" />}
      {guests.error && <Failed error={guests.error} retry={guests.reload} />}
      {guests.data && !guests.data.guest_authors.length && <Empty>No guest authors yet.</Empty>}
      {guests.data && guests.data.guest_authors.length > 0 && (
        <Rows>
          {guests.data.guest_authors.map((g) => (
            <Row key={g.id} title={g.name} meta={[count(g.posts, 'post'), g.bio].filter(Boolean).join(' · ')}
              actions={<>
                {g.url && <a className="ows-btn ows-btn--quiet" href={g.url} target="_blank" rel="noopener noreferrer">Page</a>}
                <Btn kind="quiet" onClick={() => setEditing(g)}>Edit</Btn>
                <ActionBtn kind="danger" label="Remove" doing="Removing..." yes="Remove"
                  confirm={`Remove ${g.name}?${g.posts ? ` Their name comes off ${count(g.posts, 'post')}.` : ''}`}
                  run={() => run('delete_guest_author', { guest_author_id: g.id })} done={(r) => { guests.reload(); return r?.message || `Removed ${g.name}.`; }} />
              </>} />
          ))}
        </Rows>
      )}
      {editing && <GuestForm guest={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={guests.reload} />}
    </Section>
  );
}
