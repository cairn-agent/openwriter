/**
 * The chat: talk to an agent that can read and edit the writer's documents.
 * Its edits arrive as pending changes; risky actions (publish, send, delete,
 * restore) wait for the writer to allow them here. Fills whatever box it is
 * put in, so the rail shows it as a tab and a phone layout can show it full
 * screen. History is kept per document: opening a document shows its latest
 * conversation.
 */
import { useEffect, useRef, useState } from 'react';
import AnthropicKeyForm, { useAnthropicKey } from './AnthropicKeyForm';
import { MODEL_LABELS, type ModelChoice } from './ai-api';
import { answer, newChat, sendMessage, setChatModel, showChatFor, stopAnswer, useChatSession } from './chat-session';
import './ai.css';

interface Props {
  docId: string | null;
  docTitle?: string;
  /** Open a document's pending changes in Review. */
  onOpenReview: (filename: string) => void;
}

export default function ChatPanel({ docId, docTitle, onOpenReview }: Props) {
  const s = useChatSession();
  const { key } = useAnthropicKey();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { showChatFor(docId); }, [docId]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [s.items.length, s.streaming, s.confirm, s.activity]);

  const send = () => {
    if (!draft.trim() || s.running) return;
    sendMessage(draft, { docId, title: docTitle });
    setDraft('');
  };

  if (!key) return <div className="ai-chat" />;
  const hasKey = key.saved && key.usable !== false;
  const otherDoc = s.docId !== docId && (s.items.length > 0 || s.running);

  return (
    <div className="ai-chat">
      <div className="ai-chat-head">
        <div className="ai-model-pick" role="radiogroup" aria-label="Model">
          {(Object.keys(MODEL_LABELS) as ModelChoice[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={s.model === m}
              className={`ai-model-option${s.model === m ? ' ai-model-option--on' : ''}`}
              onClick={() => setChatModel(m)}
              disabled={s.running}
            >
              {MODEL_LABELS[m]}
            </button>
          ))}
        </div>
        <button type="button" className="ai-link-btn" onClick={() => newChat(docId)} disabled={s.running}>New chat</button>
      </div>

      <div className="ai-chat-list" ref={listRef}>
        {!hasKey && (
          <div className="ai-chat-nokey">
            <p>Add your Anthropic key to use the chat. Everything else works without it.</p>
            <AnthropicKeyForm compact />
          </div>
        )}
        {hasKey && !s.loading && s.items.length === 0 && !s.running && (
          <p className="ai-chat-empty">
            Ask about {docTitle ? `"${docTitle}"` : docId ? 'this document' : 'your documents'}, or ask for edits. Edits show up as pending changes for you to accept or reject.
          </p>
        )}
        {otherDoc && <p className="ai-chat-note">This conversation started on another document.</p>}
        {s.items.map((item, i) => {
          switch (item.kind) {
            case 'user': return <div key={i} className="ai-msg ai-msg--user">{item.text}</div>;
            case 'assistant': return <div key={i} className="ai-msg ai-msg--assistant">{item.text}</div>;
            case 'error': return <div key={i} className="ai-msg ai-msg--error">{item.text}</div>;
            case 'tool': return <div key={i} className="ai-chat-tool">{item.summary} ({item.status === 'denied' ? 'not allowed' : item.status})</div>;
            case 'changes': return (
              <button key={i} type="button" className="ai-chat-changes" onClick={() => onOpenReview(item.filename)}>
                {item.count} {item.count === 1 ? 'change' : 'changes'} proposed{item.title ? ` in ${item.title}` : ''}. Review
              </button>
            );
          }
        })}
        {s.streaming && <div className="ai-msg ai-msg--assistant">{s.streaming}</div>}
        {s.confirm && (
          <div className="ai-chat-confirm">
            <p>Allow the agent to do this?</p>
            <p className="ai-chat-confirm-what">{s.confirm.summary}</p>
            <div className="ai-key-row">
              <button type="button" className="ai-key-save" onClick={() => answer(true)}>Allow</button>
              <button type="button" className="ai-link-btn" onClick={() => answer(false)}>Cancel</button>
            </div>
          </div>
        )}
        {s.running && !s.confirm && <div className="ai-chat-activity">{s.activity ? `${s.activity}…` : 'Thinking…'}</div>}
      </div>

      <div className="ai-chat-input">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder={hasKey ? 'Message' : 'Add your key first'}
          disabled={!hasKey}
          rows={3}
        />
        {s.running
          ? <button type="button" className="ai-chat-stop" onClick={stopAnswer}>Stop</button>
          : <button type="button" className="ai-key-save" onClick={send} disabled={!hasKey || !draft.trim()}>Send</button>}
      </div>
    </div>
  );
}
