/**
 * Surveys: make a survey (questions with short or long answers, one choice or several), share its
 * link or show it in a post, then read the results, each response, or download them as a sheet.
 * Once people have answered, questions can be reworded but not added, removed, moved or retyped.
 */
import { useState } from 'react';
import { count, day, run, useTool, when } from '../api';
import { go, useNav } from '../nav';
import { ActionBtn, Btn, Dialog, Empty, Failed, Field, Loading, Notice, Page, Row, Rows, Section, Tabs, Toggle } from '../ui';
import { showToast } from '../toast';

type QType = 'short_answer' | 'long_answer' | 'multiple_choice' | 'checkboxes';
type Question = { type: QType; text: string; required?: boolean; choices?: string[] };
type Survey = {
  id: string; slug: string; title: string; intro?: string | null; questions: Question[]; who_can_answer: 'subscribers' | 'anyone';
  closed: boolean; closed_at?: string | null; responses: number; url: string | null; marker: string; created_at: string;
};

const TYPES: Array<[QType, string]> = [['short_answer', 'Short answer'], ['long_answer', 'Long answer'], ['multiple_choice', 'One choice'], ['checkboxes', 'Several choices']];
const MAX_QUESTIONS = 20;
const hasChoices = (t: QType) => t === 'multiple_choice' || t === 'checkboxes';

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copy(text: string, what: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); showToast(`Copied ${what}.`, 'info'); } catch { showToast(text, 'info', 10000); }
}

/** One question being edited: choices are typed one per line. */
type Draft = { type: QType; text: string; required: boolean; choices: string };
const toDraft = (q: Question): Draft => ({ type: q.type, text: q.text, required: !!q.required, choices: (q.choices || []).join('\n') });
const fromDraft = (d: Draft): Question => ({
  type: d.type, text: d.text.trim(), required: d.required,
  ...(hasChoices(d.type) ? { choices: d.choices.split('\n').map((c) => c.trim()).filter(Boolean) } : {}),
});

function SurveyEditor({ survey, onClose, onSaved }: { survey: Survey | null; onClose: () => void; onSaved: (s: Survey) => void }) {
  const [title, setTitle] = useState(survey?.title ?? '');
  const [intro, setIntro] = useState(survey?.intro ?? '');
  const [who, setWho] = useState<'subscribers' | 'anyone'>(survey?.who_can_answer ?? 'subscribers');
  const [qs, setQs] = useState<Draft[]>(survey ? survey.questions.map(toDraft) : [{ type: 'multiple_choice', text: '', required: true, choices: '' }]);
  const locked = !!survey && survey.responses > 0;
  const setQ = (i: number, patch: Partial<Draft>) => setQs(qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, by: number) => { const next = [...qs]; [next[i], next[i + by]] = [next[i + by], next[i]]; setQs(next); };
  const problem = !title.trim() ? 'Give the survey a title.'
    : qs.some((q) => !q.text.trim()) ? 'Every question needs its wording.'
    : qs.some((q) => hasChoices(q.type) && fromDraft(q).choices!.length < 2) ? 'Choice questions need at least two choices, one per line.'
    : null;
  return (
    <Dialog wide title={survey ? `Edit "${survey.title}"` : 'New survey'} onClose={onClose}
      footer={<>
        {problem && <span className="ows-sub">{problem}</span>}
        <ActionBtn kind="primary" label={survey ? 'Save' : 'Make the survey'} doing="Saving..." disabled={!!problem}
          run={() => run<{ survey: Survey; message: string }>('save_survey', {
            ...(survey ? { survey_id: survey.id } : {}), title: title.trim(), intro: intro.trim(), who_can_answer: who, questions: qs.map(fromDraft),
          })}
          done={(r) => { onSaved(r.survey); onClose(); return r.message || 'Saved.'; }} />
      </>}>
      <Field label="Title"><input className="ows-input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!survey} /></Field>
      <Field label="Introduction (optional)" hint="Shown above the questions: what it is for, how long it takes.">
        <textarea className="ows-input" rows={2} value={intro} onChange={(e) => setIntro(e.target.value)} />
      </Field>
      <Field label="Who can answer">
        <Tabs label="Who can answer" value={who} onChange={setWho} options={[{ value: 'subscribers', label: 'Subscribers' }, { value: 'anyone', label: 'Anyone with the link' }]} />
      </Field>
      {locked && <Notice>People have answered, so you can reword questions and choices, but not add, remove, move or change their kind. To ask something else, make a new survey.</Notice>}
      {qs.map((q, i) => (
        <div key={i} className="ows-question">
          <div className="ows-question-head">
            <span className="ows-field-label">Question {i + 1}</span>
            {!locked && (
              <span className="ows-question-tools">
                <Btn kind="quiet" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">Up</Btn>
                <Btn kind="quiet" disabled={i === qs.length - 1} onClick={() => move(i, 1)} title="Move down">Down</Btn>
                <Btn kind="quiet" disabled={qs.length === 1} onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove</Btn>
              </span>
            )}
          </div>
          <input className="ows-input" placeholder="What do you want to ask?" value={q.text} onChange={(e) => setQ(i, { text: e.target.value })} />
          <div className="ows-grid2">
            <select className="ows-input" aria-label={`Kind of answer for question ${i + 1}`} value={q.type} disabled={locked} onChange={(e) => setQ(i, { type: e.target.value as QType })}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Toggle label="Must be answered" checked={q.required} onChange={(v) => setQ(i, { required: v })} />
          </div>
          {hasChoices(q.type) && (
            <Field label="Choices, one per line" hint={locked ? 'Reword them, keeping the same number.' : undefined}>
              <textarea className="ows-input" rows={Math.max(3, q.choices.split('\n').length)} value={q.choices} onChange={(e) => setQ(i, { choices: e.target.value })} />
            </Field>
          )}
        </div>
      ))}
      {!locked && qs.length < MAX_QUESTIONS && (
        <Btn onClick={() => setQs([...qs, { type: 'short_answer', text: '', required: false, choices: '' }])}>Add a question</Btn>
      )}
    </Dialog>
  );
}

function OpenClose({ s, onDone }: { s: Survey; onDone: () => void }) {
  return s.closed
    ? <ActionBtn kind="quiet" label="Reopen survey" doing="Reopening..." run={() => run('close_survey', { survey_id: s.id, reopen: true })} done={(r) => { onDone(); return r?.message || 'Reopened.'; }} />
    : <ActionBtn kind="quiet" label="Close survey" doing="Closing..." confirm={`Close "${s.title}"? Readers can no longer answer; the answers so far stay.`} yes="Close it"
        run={() => run('close_survey', { survey_id: s.id })} done={(r) => { onDone(); return r?.message || 'Closed.'; }} />;
}

function Results({ id }: { id: string }) {
  const r = useTool<{ total_responses: number; questions: any[] }>('get_survey_results', { survey_id: id });
  if (r.loading && !r.data) return <Loading what="the results" />;
  if (r.error) return <Failed error={r.error} retry={r.reload} />;
  if (!r.data!.total_responses) return <Empty>No answers yet. Share the link, or show the survey in a post.</Empty>;
  return (
    <>
      {r.data!.questions.map((q) => (
        <Section key={q.number} title={`${q.number}. ${q.text}`} aside={<span className="ows-sub">{count(q.answered, 'answer')}</span>}>
          {q.choices && q.choices.map((c: any, j: number) => (
            <div key={j} className="ows-poll-row">
              <span className="ows-poll-bar" style={{ width: `${c.percent}%` }} />
              <span className="ows-poll-text">{c.text}</span>
              <span className="ows-poll-num">{c.percent}% · {c.count.toLocaleString()}</span>
            </div>
          ))}
          {q.answers && (q.answers.length
            ? <ul className="ows-answers">{q.answers.map((a: string, j: number) => <li key={j}>{a}</li>)}</ul>
            : <Empty>Nobody answered this one.</Empty>)}
          {q.more > 0 && <p className="ows-sub">Showing the newest 500. Download the answers for all of them.</p>}
        </Section>
      ))}
    </>
  );
}

function Responses({ id }: { id: string }) {
  const [offset, setOffset] = useState(0);
  const r = useTool<{ total: number; responses: any[] }>('list_survey_responses', { survey_id: id, limit: 50, offset });
  if (r.loading && !r.data) return <Loading what="the answers" />;
  if (r.error) return <Failed error={r.error} retry={r.reload} />;
  if (!r.data!.total) return <Empty>No answers yet.</Empty>;
  const show = (a: any) => (a === null ? 'No answer' : Array.isArray(a) ? a.join(', ') || 'No answer' : a);
  return (
    <>
      <Rows>
        {r.data!.responses.map((x) => (
          <Row key={x.id} title={x.email ? (x.name ? `${x.name} (${x.email})` : x.email) : 'Not signed in'}
            meta={<>{when(x.submitted_at)}{x.answers.map((a: any, j: number) => <span key={j} className="ows-answer"><br /><strong>{a.question}</strong> {show(a.answer)}</span>)}</>} />
        ))}
      </Rows>
      {r.data!.total > 50 && (
        <div className="ows-actions">
          <Btn kind="quiet" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Newer</Btn>
          <span className="ows-sub">{offset + 1}-{Math.min(offset + 50, r.data!.total)} of {r.data!.total.toLocaleString()}</span>
          <Btn kind="quiet" disabled={offset + 50 >= r.data!.total} onClick={() => setOffset(offset + 50)}>Older</Btn>
        </div>
      )}
    </>
  );
}

function SurveyPage({ id }: { id: string }) {
  const list = useTool<{ surveys: Survey[] }>('list_surveys');
  const [view, setView] = useState<'results' | 'responses'>('results');
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);
  if (list.loading && !list.data) return <Page title="Survey"><Loading what="the survey" /></Page>;
  if (list.error) return <Page title="Survey"><Failed error={list.error} retry={list.reload} /></Page>;
  const s = list.data!.surveys.find((x) => x.id === id || x.slug === id);
  if (!s) return <Page title="Survey"><Empty>This survey no longer exists. <button type="button" className="ows-link" onClick={() => go('surveys')}>All surveys</button></Empty></Page>;
  const reload = () => { list.reload(); setTick((t) => t + 1); };
  return (
    <Page title={s.title}
      sub={<>{count(s.responses, 'response')} · {s.closed ? 'Closed' : 'Open'} · {s.who_can_answer === 'anyone' ? 'anyone with the link can answer' : 'subscribers can answer'} · <button type="button" className="ows-link" onClick={() => go('surveys')}>All surveys</button></>}
      actions={<>
        {s.url && <Btn onClick={() => void copy(s.url!, 'the link')}>Copy link</Btn>}
        <Btn onClick={() => void copy(s.marker, 'the line for a post; paste it on its own line')}>Copy line for a post</Btn>
        <Btn onClick={() => setEditing(true)}>Edit</Btn>
        <ActionBtn label="Download answers" doing="Preparing..." disabled={!s.responses}
          run={() => run<{ csv: string; rows: number }>('export_survey_responses', { survey_id: s.id })}
          done={(r) => { download(`${s.slug}-answers.csv`, r.csv); return `Downloaded ${count(r.rows, 'response')}.`; }} />
        <OpenClose s={s} onDone={reload} />
      </>}>
      {s.url
        ? <p className="ows-sub"><a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a></p>
        : <Notice kind="warn">The survey gets a link once your site has an address. <button type="button" className="ows-link" onClick={() => go('home')}>Choose it on Home</button></Notice>}
      <Tabs label="Survey" value={view} onChange={setView} options={[{ value: 'results', label: 'Results' }, { value: 'responses', label: 'Each response' }]} />
      {view === 'results' ? <Results key={tick} id={s.id} /> : <Responses key={tick} id={s.id} />}
      {editing && <SurveyEditor survey={s} onClose={() => setEditing(false)} onSaved={reload} />}
    </Page>
  );
}

export default function Surveys() {
  const nav = useNav();
  const list = useTool<{ surveys: Survey[] }>('list_surveys');
  const [making, setMaking] = useState(false);
  if (nav.item) return <SurveyPage id={nav.item} />;
  return (
    <Page title="Surveys" actions={<Btn kind="primary" onClick={() => setMaking(true)}>New survey</Btn>}>
      <p className="ows-sub">Ask your readers anything. Each survey has its own page to share, and can be shown in a post: right-click in the editor and choose Insert block, Survey.</p>
      {list.loading && !list.data && <Loading what="surveys" />}
      {list.error && <Failed error={list.error} retry={list.reload} />}
      {list.data && !list.data.surveys.length && <Empty>No surveys yet.</Empty>}
      {list.data && list.data.surveys.length > 0 && (
        <Rows>
          {list.data.surveys.map((s) => (
            <Row key={s.id} title={s.title} onOpen={() => go('surveys', s.id)}
              meta={[count(s.responses, 'response'), s.closed ? 'closed' : 'open', s.who_can_answer === 'anyone' ? 'anyone can answer' : 'subscribers only', `made ${day(s.created_at)}`].join(' · ')}
              actions={<>
                <Btn kind="quiet" onClick={() => go('surveys', s.id)}>Results</Btn>
                {s.url && <Btn kind="quiet" onClick={() => void copy(s.url!, 'the link')}>Copy link</Btn>}
                <OpenClose s={s} onDone={list.reload} />
                <ActionBtn kind="danger" label="Delete" doing="Deleting..." yes="Delete"
                  confirm={`Delete "${s.title}"${s.responses ? ` and its ${count(s.responses, 'response')}` : ''}? Posts that show it stop showing it.`}
                  run={() => run('delete_survey', { survey_id: s.id })} done={(r) => { list.reload(); return r?.message || 'Deleted.'; }} />
              </>} />
          ))}
        </Rows>
      )}
      {making && <SurveyEditor survey={null} onClose={() => setMaking(false)} onSaved={(s) => { list.reload(); go('surveys', s.id); }} />}
    </Page>
  );
}
