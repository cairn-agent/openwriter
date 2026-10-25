/**
 * Subscribers' extras: saved segments (pick one, or save the current filter as one), a member's
 * tags, and cleaning up readers who stopped opening (ask them first, then remove them).
 */
import { useState } from 'react';
import { count, day, run, useTool } from './api';
import { ActionBtn, Btn, Empty, Field, Notice, Row, Rows, Section } from './ui';
import { showToast } from './toast';

export function SegmentPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const segs = useTool<{ segments: any[] }>('list_segments');
  const list = segs.data?.segments || [];
  if (!list.length) return null;
  return (
    <select className="ows-input ows-select-sm" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Segment">
      <option value="">No segment</option>
      {list.map((s) => <option key={s.id} value={s.name}>{s.name} ({s.count})</option>)}
    </select>
  );
}

export function SaveSegment({ filter, onSaved }: { filter: Record<string, unknown>; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  if (!Object.keys(filter).length) return null;
  if (!open) return <Btn kind="quiet" onClick={() => setOpen(true)}>Save this filter</Btn>;
  return (
    <span className="ows-inline">
      <input className="ows-input" placeholder="Segment name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <ActionBtn label="Save" doing="Saving..." disabled={!name.trim()} run={() => run('save_segment', { name: name.trim(), ...filter })}
        done={(r) => { setOpen(false); setName(''); onSaved(); return r?.message || 'Saved.'; }} />
    </span>
  );
}

export function MemberTags({ id, tags, onChange }: { id: string; tags: string[]; onChange: () => void }) {
  const [tag, setTag] = useState('');
  const change = async (args: Record<string, unknown>) => {
    try { await run('tag_subscribers', { member_ids: [id], ...args }); onChange(); } catch (err: any) { showToast(err?.message || 'That did not save.', 'error'); }
  };
  return (
    <Section title="Tags">
      <div className="ows-tags">
        {tags.map((t) => <span key={t} className="ows-tagchip">{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => void change({ remove: [t] })}>×</button></span>)}
        {!tags.length && <span className="ows-sub">No tags.</span>}
      </div>
      <div className="ows-inline">
        <input className="ows-input" placeholder="Add a tag" value={tag} onChange={(e) => setTag(e.target.value.replace(/[,;|]/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter' && tag.trim()) { void change({ add: [tag.trim()] }); setTag(''); } }} />
        <Btn disabled={!tag.trim()} onClick={() => { void change({ add: [tag.trim()] }); setTag(''); }}>Add</Btn>
      </div>
    </Section>
  );
}

export function Cleanup({ onDone }: { onDone: () => void }) {
  const [days, setDays] = useState(180);
  const found = useTool<any>('find_inactive_subscribers', { days });
  const pruned = useTool<{ pruned: any[]; total: number }>('list_pruned_subscribers', { limit: 20 });
  const [ask, setAsk] = useState<any | null>(null);
  const d = found.data;
  return (
    <Section title="Readers who stopped opening">
      <p className="ows-sub">{d?.why || 'Removing people who never open helps your emails reach everyone else: inbox providers watch how many recipients ignore you.'}</p>
      <Field label="Not opened in">
        <select className="ows-input ows-select-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[90, 180, 270, 365].map((n) => <option key={n} value={n}>{n} days</option>)}
        </select>
      </Field>
      {found.loading && !d && <p className="ows-sub">Counting...</p>}
      {d && <Notice kind={d.count ? 'warn' : 'info'}>{d.message}</Notice>}
      {d?.last_ask && <p className="ows-sub">You asked on {day(d.last_ask.sent_at)}; removal is possible from {day(d.last_ask.prune_from)}.</p>}
      {d?.count > 0 && (
        <div className="ows-actions">
          <ActionBtn label="Ask them first" doing="Counting..."
            run={async () => { const r = await run('ask_inactive_subscribers', { days, dry_run: true }); setAsk(r); return r; }} done={() => null} />
          <ActionBtn kind="danger" label={`Remove ${count(d.count, 'reader')}`} doing="Removing..."
            confirm={`Unsubscribe ${count(d.count, 'free reader')} who have not opened in ${days} days? Paid and complimentary readers are never removed.`} yes="Remove them"
            run={() => run('prune_inactive_subscribers', { days, dry_run: false })} done={(r) => { found.reload(); pruned.reload(); onDone(); return r?.message || 'Removed.'; }} />
        </div>
      )}
      {ask && (
        <Notice>
          {ask.message}{' '}
          {ask.can_send && (
            <ActionBtn kind="primary" label={`Send "Still want this?" to ${count(ask.recipients, 'person', 'people')}`} doing="Sending..."
              run={() => run('ask_inactive_subscribers', { days })} done={(r) => { setAsk(null); found.reload(); return r?.message || 'Sent. Anyone who opens it stays.'; }} />
          )}
        </Notice>
      )}
      {pruned.data && pruned.data.total > 0 && (
        <>
          <h3 className="ows-h3">Removed before</h3>
          <Rows>
            {pruned.data.pruned.map((p, i) => <Row key={i} title={p.email} meta={[day(p.pruned_at), p.reason].filter(Boolean).join(' · ')} />)}
          </Rows>
        </>
      )}
      {d && !d.count && !pruned.data?.total && <Empty>Everyone has opened something recently.</Empty>}
    </Section>
  );
}
