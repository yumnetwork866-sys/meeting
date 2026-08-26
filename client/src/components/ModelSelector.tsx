import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { CustomSelect } from './CustomSelect';

interface ModelSelectorProps {
  model: string;
  onSaveModel: (model: string) => void;
}

export const MODEL_OPTIONS = [
  { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
  { value: 'gemini-3.5-live-translate-preview', label: 'Gemini 3.5 Live Translate' },
];

const CUSTOM_VALUE = '__custom__';

export const ModelSelector: React.FC<ModelSelectorProps> = ({ model, onSaveModel }) => {
  const isPreset = MODEL_OPTIONS.some((opt) => opt.value === model);
  const [customMode, setCustomMode] = useState(!isPreset && !!model);
  const [draft, setDraft] = useState(isPreset ? '' : model);

  // Sync when external model changes (server load, parent updates)
  useEffect(() => {
    const matches = MODEL_OPTIONS.some((opt) => opt.value === model);
    setCustomMode(!matches && !!model);
    setDraft(matches ? '' : model);
  }, [model]);

  if (customMode) {
    return (
      <div className="model-selector custom">
        <input
          type="text"
          className="input-control font-mono model-input"
          value={draft}
          placeholder="gemini-..."
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              onSaveModel(draft.trim());
              setCustomMode(false);
            } else if (e.key === 'Escape') {
              setCustomMode(false);
              setDraft(isPreset ? '' : model);
            }
          }}
        />
        <button
          type="button"
          className="model-icon-btn confirm"
          title="Lưu slug"
          onClick={() => {
            if (draft.trim()) {
              onSaveModel(draft.trim());
              setCustomMode(false);
            }
          }}
        >
          <Check size={14} />
        </button>
        <button
          type="button"
          className="model-icon-btn cancel"
          title="Huỷ"
          onClick={() => {
            setCustomMode(false);
            setDraft(isPreset ? '' : model);
          }}
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="model-selector">
      <CustomSelect
        className="model-custom-select"
        triggerClassName="font-mono model-select"
        ariaLabel="Chọn model"
        value={isPreset ? model : CUSTOM_VALUE}
        options={[
          ...MODEL_OPTIONS,
          ...(!isPreset && model ? [{ value: model, label: `Tùy chỉnh: ${model}` }] : []),
          { value: CUSTOM_VALUE, label: 'Tùy chỉnh slug...' },
        ]}
        onChange={(v) => {
          if (v === CUSTOM_VALUE) {
            setCustomMode(true);
            setDraft(isPreset ? '' : model);
          } else {
            onSaveModel(v);
          }
        }}
      />
    </div>
  );
};
