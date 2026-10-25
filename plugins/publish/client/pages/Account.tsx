/**
 * Settings > Account: download everything, hand the site to a team admin, or delete it. Delete
 * asks for the site's name typed out; it is refused while anyone still pays.
 */
import { useState } from 'react';
import { run, useTool } from '../api';
import { close } from '../nav';
import { useSite } from '../SiteApp';
import { ActionBtn, Field, Notice, Section } from '../ui';

export default function Account() {
  const { info } = useSite();
  const isOwner = info.role === 'owner';
  const team = useTool<{ members: any[] }>('list_site_team');
  const admins = (team.data?.members || []).filter((m) => m.role === 'admin' && m.accepted_at);
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const siteName = info.site?.name || '';
  const chosen = admins.find((a) => a.id === to);

  return (
    <>
      <Section title="Sign-in">
        <p className="ows-sub">Two-factor sign-in asks for a code from an authenticator app as well as the emailed code, so someone who gets into your email still cannot sign in as you.</p>
        <a className="ows-btn" href="/_auth/account">Two-factor sign-in</a>
      </Section>

      {info.role !== 'contributor' && (<Section title="Download everything">
        <p className="ows-sub">One zip: every post (as Markdown and as the page), your subscribers as a spreadsheet, comments, settings, sections, tags and plans. The link works for 15 minutes.</p>
        <ActionBtn label="Download a copy" doing="Preparing..."
          run={async () => { const r = await run<{ url: string }>('export_site'); window.location.assign(r.url); return r; }}
          done={(r) => r?.message || 'Your download has started.'} />
      </Section>)}

      {isOwner && (
        <Section title="Hand the site over">
          <p className="ows-sub">Make one of your admins the owner. You stay on as an admin. Stripe stays connected, so payments keep going to your Stripe until the new owner connects theirs.</p>
          {admins.length === 0 ? <Notice>Only an admin who has joined can become the owner. Invite one on the Team tab first.</Notice> : (
            <>
              <Field label="New owner">
                <select className="ows-input" value={to} onChange={(e) => setTo(e.target.value)}>
                  <option value="">Choose an admin</option>
                  {admins.map((a) => <option key={a.id} value={a.id}>{a.name || a.invited_email}</option>)}
                </select>
              </Field>
              <ActionBtn kind="danger" label="Make them the owner" doing="Handing over..." disabled={!chosen}
                confirm={`Make ${chosen?.name || chosen?.invited_email} the owner of ${siteName}? Only they can undo it.`} yes="Hand it over"
                run={() => run('transfer_site_ownership', { member_id: to, confirm: true })}
                done={(r) => r?.message || 'Done.'} />
            </>
          )}
        </Section>
      )}

      {isOwner && (
        <Section title="Delete this site">
          <p className="ows-sub">Your posts come off the web, your subscribers are deleted and the address is freed. Download a copy first. Your documents in OpenWriter are not touched. Anyone still paying must be cancelled first, on their page in Subscribers.</p>
          <Field label={`Type the site's name to confirm: ${siteName}`}>
            <input className="ows-input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <ActionBtn kind="danger" label="Delete this site" doing="Deleting..." disabled={name.trim().toLowerCase() !== siteName.trim().toLowerCase() || !siteName}
            confirm={`Delete ${siteName} for good? This cannot be undone.`} yes="Delete for good"
            run={() => run('delete_site', { confirm_name: name.trim() })}
            done={(r) => { setTimeout(() => close(), 1500); return r?.message || `Deleted ${siteName}.`; }} />
        </Section>
      )}
    </>
  );
}
