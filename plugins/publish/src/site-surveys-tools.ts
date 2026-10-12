import { writeFileSync } from 'fs';
import type { PluginMcpTool } from './helpers.js';
import { publishFetch } from './helpers.js';
import { apiError, onSite, pick, SITE_PARAM } from './site-tools.js';

/**
 * Surveys on the writer's site: a page of questions readers answer once, shared by link or placed
 * in a post with a "[survey] <slug>" line. Listing is open to contributors (to place one in a post);
 * everything else is for owners and admins, since responses name readers.
 */

const seg = (s: unknown) => encodeURIComponent(String(s ?? '').trim());

const SURVEY_ID = {
  survey_id: { type: 'string', description: 'The survey\'s id or its address name (slug), from list_surveys.' },
};

const QUESTION = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['short_answer', 'long_answer', 'multiple_choice', 'checkboxes'],
      description: 'short_answer (a line, up to 500 characters), long_answer (a paragraph, up to 5000), multiple_choice (one answer), checkboxes (any number).',
    },
    text: { type: 'string', description: 'The question, up to 500 characters.' },
    required: { type: 'boolean', description: 'Readers must answer it (default false).' },
    choices: { type: 'array', items: { type: 'string' }, description: 'For multiple_choice and checkboxes: 2 to 20 different choices, up to 200 characters each.' },
  },
  required: ['type', 'text'],
};

export function siteSurveysTools(config: Record<string, string>): PluginMcpTool[] {
  return [
    {
      name: 'list_surveys',
      description:
        'List the site\'s surveys, newest first: title, intro, questions, who can answer, whether it is closed, how many responses, ' +
        'its page (url) and the marker line that puts it in a post (marker, e.g. "[survey] reader-survey").',
      inputSchema: { type: 'object', properties: { ...SITE_PARAM } },
      handler: async (params) => {
        const res = await publishFetch(config, '/sites/surveys', onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the surveys');
        return (await res.json()) as object;
      },
    },

    {
      name: 'save_survey',
      description:
        'Make a survey, or change one (pass survey_id). A survey has a title, an optional intro and 1 to 20 questions; it gets its own page ' +
        'on the site to share by link, and the line it returns as marker (on a line of its own in a post, then publish) shows it in a post: ' +
        'a card on the page, a link in the email. Readers answer once. who_can_answer: "subscribers" (signed in, the default) or "anyone". ' +
        'Its page address is made from the title once and never changes. Once it has responses, questions can be reworded but not added, ' +
        'removed, moved, retyped or given more or fewer choices. Only the fields you pass change; questions replace the whole list.',
      inputSchema: {
        type: 'object',
        properties: {
          survey_id: { type: 'string', description: 'The survey to change (list_surveys). Leave out to make a new one.' },
          title: { type: 'string', description: 'Up to 150 characters. Required for a new survey.' },
          intro: { type: 'string', description: 'A few lines above the questions, up to 2000 characters (blank lines start a new paragraph). An empty string removes it.' },
          questions: { type: 'array', items: QUESTION, description: 'The questions in order, 1 to 20. Required for a new survey.' },
          who_can_answer: { type: 'string', enum: ['subscribers', 'anyone'], description: 'subscribers (signed-in subscribers, the default) or anyone.' },
          ...SITE_PARAM,
        },
      },
      handler: async (params) => {
        const body = pick(params, ['title', 'intro', 'questions', 'who_can_answer']);
        const id = typeof params.survey_id === 'string' && params.survey_id.trim() ? params.survey_id.trim() : null;
        if (!id && (!body.title || !body.questions)) return { error: 'A new survey needs a title and its questions.' };
        if (id && !Object.keys(body).length) return { error: 'Pass at least one field to change.' };
        const res = await publishFetch(config, id ? `/sites/surveys/${seg(id)}` : '/sites/surveys', onSite(params.site, {
          method: id ? 'PATCH' : 'POST', body: JSON.stringify(body),
        }));
        if (!res.ok) return apiError(res, 'Could not save the survey');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'close_survey',
      description:
        'Close a survey: readers can no longer answer it, and its page says so; the responses stay. reopen: true takes responses again.',
      inputSchema: {
        type: 'object',
        properties: { ...SURVEY_ID, reopen: { type: 'boolean', description: 'Reopen a closed survey instead.' }, ...SITE_PARAM },
        required: ['survey_id'],
      },
      handler: async (params) => {
        const action = params.reopen === true ? 'open' : 'close';
        const res = await publishFetch(config, `/sites/surveys/${seg(params.survey_id)}/${action}`, onSite(params.site, { method: 'POST' }));
        if (!res.ok) return apiError(res, `Could not ${action === 'open' ? 'reopen' : 'close'} the survey`);
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'delete_survey',
      description:
        'Delete a survey and every response to it. Its page stops working and posts that show it no longer do. It cannot be undone: ' +
        'only when the writer asks (export_survey_responses first if they want to keep the answers).',
      inputSchema: { type: 'object', properties: { ...SURVEY_ID, ...SITE_PARAM }, required: ['survey_id'] },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/surveys/${seg(params.survey_id)}`, onSite(params.site, { method: 'DELETE' }));
        if (!res.ok) return apiError(res, 'Could not delete the survey');
        return { success: true, ...((await res.json()) as object) };
      },
    },

    {
      name: 'get_survey_results',
      description:
        'A survey\'s results: the number of responses, and per question how many answered it; for multiple choice and checkboxes each ' +
        'choice\'s count and percent of those who answered (checkboxes can add up past 100); for text questions the answers, newest first ' +
        '(up to 500; "more" counts the rest, which export_survey_responses has).',
      inputSchema: { type: 'object', properties: { ...SURVEY_ID, ...SITE_PARAM }, required: ['survey_id'] },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/surveys/${seg(params.survey_id)}/results`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the results');
        return (await res.json()) as object;
      },
    },

    {
      name: 'list_survey_responses',
      description:
        'Individual responses to a survey, newest first: when it was sent, the reader\'s email and name when they were signed in ' +
        '(null for someone who answered without signing in), and each answer in words (a list for checkboxes, null when left blank).',
      inputSchema: {
        type: 'object',
        properties: {
          ...SURVEY_ID,
          limit: { type: 'number', description: 'Max responses to return (default 50, at most 200).' },
          offset: { type: 'number', description: 'Pagination offset (default 0).' },
          ...SITE_PARAM,
        },
        required: ['survey_id'],
      },
      handler: async (params) => {
        const q = new URLSearchParams();
        for (const k of ['limit', 'offset']) if (params[k] !== undefined && params[k] !== null) q.set(k, String(params[k]));
        const query = q.toString();
        const res = await publishFetch(config, `/sites/surveys/${seg(params.survey_id)}/responses${query ? `?${query}` : ''}`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Could not load the responses');
        return (await res.json()) as object;
      },
    },

    {
      name: 'export_survey_responses',
      description:
        'Export every response to a survey as CSV: submitted_at, email, name, then one column per question (ticked choices joined by "; "). ' +
        'Saves to file when given, otherwise returns the CSV text.',
      inputSchema: {
        type: 'object',
        properties: {
          ...SURVEY_ID,
          file: { type: 'string', description: 'Absolute path to save the CSV to (e.g. "C:/Users/me/Downloads/survey.csv")' },
          ...SITE_PARAM,
        },
        required: ['survey_id'],
      },
      handler: async (params) => {
        const res = await publishFetch(config, `/sites/surveys/${seg(params.survey_id)}/export`, onSite(params.site));
        if (!res.ok) return apiError(res, 'Export failed');
        const csv = await res.text();
        // Records, not lines: a long answer can hold line breaks inside its quotes.
        let records = 0;
        let quoted = false;
        for (const ch of csv) {
          if (ch === '"') quoted = !quoted;
          else if (ch === '\n' && !quoted) records++;
        }
        const rows = Math.max(records - 1, 0);
        if (!params.file) return { rows, csv };
        try {
          writeFileSync(String(params.file), csv, 'utf-8');
        } catch (e: any) {
          return { error: `Failed to save file: ${e.message}` };
        }
        return { success: true, rows, file: params.file, message: `Saved ${rows} responses to ${params.file}.` };
      },
    },
  ];
}
