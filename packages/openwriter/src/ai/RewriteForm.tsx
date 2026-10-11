/**
 * The Rewrite step of the editor's right-click menu: an optional instruction and
 * the model (Opus, Sonnet or Haiku). The last model picked is remembered.
 */
import { useState } from 'react';
import { MODEL_LABELS, rememberModel, rememberedModel, type ModelChoice } from './ai-api';
import './ai.css';

interface Props {
  onSubmit: (instruction: string, model: ModelChoice) => void;
  onCancel: () => void;
}

export default function RewriteForm({ onSubmit, onCancel }: Props) {
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState<ModelChoice>(() => rememberedModel('rewrite', 'opus'));

  const submit = () => {
    rememberModel('rewrite', model);
    onSubmit(instruction, model);
  };

  return (
    <div className="ai-rewrite-form">
      <input
        autoFocus
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="How to rewrite it (optional)"
        maxLength={2000}
      />
      <div className="ai-rewrite-row">
        <div className="ai-model-pick" role="radiogroup" aria-label="Model">
          {(Object.keys(MODEL_LABELS) as ModelChoice[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={model === m}
              className={`ai-model-option${model === m ? ' ai-model-option--on' : ''}`}
              onClick={() => setModel(m)}
            >
              {MODEL_LABELS[m]}
            </button>
          ))}
        </div>
        <button type="button" className="ai-rewrite-go" onClick={submit}>Rewrite</button>
      </div>
    </div>
  );
}
