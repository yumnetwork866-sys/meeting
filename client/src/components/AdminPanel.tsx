import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Key, ChevronDown, ChevronUp, Activity, RefreshCw } from 'lucide-react';

interface AdminPanelProps {
  apiKey: string;
  onSaveKey: (key: string) => void;
  isKeyValid: 'valid' | 'invalid' | 'unchecked' | 'checking';
  keyError: string;
  onCheckKey: (keyToCheck?: string, modelToCheck?: string) => Promise<boolean>;
  ttsStatus: 'ready' | 'error' | 'checking' | 'unconfigured';
  onCheckTTS: () => Promise<void> | void;
  model: string;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({
  apiKey,
  onSaveKey,
  isKeyValid,
  keyError,
  onCheckKey,
  ttsStatus,
  onCheckTTS,
  model,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [localKey, setLocalKey] = useState(apiKey);
  const [testing, setTesting] = useState(false);

  // Sync local state when parent loads config from server asynchronously.
  useEffect(() => {
    setLocalKey(apiKey);
  }, [apiKey]);

  const handleSave = () => {
    onSaveKey(localKey);
  };

  const handleTest = async () => {
    setTesting(true);
    onSaveKey(localKey); // Auto-save first
    try {
      await Promise.all([
        onCheckKey(localKey, model), // Validate with the input key and selected model
        onCheckTTS(),
      ]);
    } finally {
      setTesting(false);
    }
  };

  const keyDot =
    isKeyValid === 'valid' ? 'ok' :
    isKeyValid === 'invalid' ? 'err' :
    isKeyValid === 'checking' ? 'pending' : 'idle';
  const ttsDot =
    ttsStatus === 'ready' ? 'ok' :
    ttsStatus === 'error' ? 'err' :
    ttsStatus === 'checking' ? 'pending' : 'idle';

  return (
    <div className="panel-card">
      <div className="panel-header" onClick={() => setIsOpen(!isOpen)}>
        <h2>
          <Key size={18} className="logo-icon" />
          Cấu hình API Key
        </h2>
        <div className="status-pill-group" onClick={(e) => e.stopPropagation()}>
          <span className={`status-pill ${keyDot}`} title="Gemini API">Gemini</span>
          <span className={`status-pill ${ttsDot}`} title="Edge TTS">TTS</span>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div className="panel-content">
              <div className="input-group">
                <label className="input-label">Google AI Studio API Key</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="password"
                    className="input-control"
                    placeholder="AIzaSy..."
                    value={localKey}
                    onChange={(e) => setLocalKey(e.target.value)}
                  />
                  <button className="btn btn-secondary font-mono" onClick={handleSave}>
                    Lưu
                  </button>
                </div>
              </div>

              <button
                className="btn btn-primary"
                onClick={handleTest}
                disabled={testing}
                style={{ width: '100%' }}
              >
                {testing ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Activity size={16} />
                )}
                Kiểm tra kết nối
              </button>

              {isKeyValid === 'invalid' && keyError && (
                <div
                  className="font-mono"
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--color-error)',
                    lineHeight: 1.4,
                    overflowWrap: 'anywhere',
                    background: 'rgba(239, 68, 68, 0.06)',
                    padding: '0.5rem 0.75rem',
                    borderRadius: '0.5rem',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                  }}
                >
                  {keyError}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
