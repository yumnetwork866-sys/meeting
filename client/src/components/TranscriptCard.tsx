import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Copy, Check, Trash2, Loader2, Sparkles, Volume2 } from 'lucide-react';
import type { TranscriptItem } from '../hooks/useTranslator';
import { Flag, getLanguageName } from './LanguageSelector';

interface TranscriptCardProps {
  item: TranscriptItem;
  onDelete: (id: string) => void;
  speakOriginal: (text: string, language: string, cardId: string) => Promise<void>;
  speakAI: (text: string, language: string, cardId: string) => Promise<void>;
  playingCardId: string | null;
  loadingCardId: string | null;
  variant?: 'default' | 'team';
}

export const TranscriptCard: React.FC<TranscriptCardProps> = ({
  item,
  onDelete,
  speakOriginal,
  speakAI,
  playingCardId,
  loadingCardId,
  variant = 'default',
}) => {
  const [copiedOriginal, setCopiedOriginal] = useState(false);
  const [copiedTranslated, setCopiedTranslated] = useState(false);

  const handleCopyOriginal = async () => {
    try {
      await navigator.clipboard.writeText(item.originalText);
      setCopiedOriginal(true);
      setTimeout(() => setCopiedOriginal(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyTranslated = async () => {
    try {
      await navigator.clipboard.writeText(item.translatedText);
      setCopiedTranslated(true);
      setTimeout(() => setCopiedTranslated(false), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const isOriginalPlaying = playingCardId === `${item.id}-original`;
  const isAIPlaying = playingCardId === `${item.id}-ai`;
  const isAILoading = loadingCardId === `${item.id}-ai`;
  const speakerLabel = item.speakerName || (item.isSelf ? 'Bạn' : 'Người nói');
  const cardClassName = variant === 'team'
    ? `transcript-card team-transcript-message ${item.isSelf ? 'team-transcript-message-self' : 'team-transcript-message-other'}`
    : 'transcript-card';

  if (variant === 'team') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 12, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        className={cardClassName}
      >
        <div className="team-message-shell">
          <div className="team-message-avatar" aria-hidden="true">
            {(speakerLabel || '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="team-message-column">
            <div className="team-message-meta">
              <strong>{speakerLabel}</strong>
              <span>{item.timestamp}</span>
            </div>

            <div className="team-message-bubble">
              <div className="team-message-langline">
                <span className="team-message-langchip">
                  Gốc · <span className="font-mono">{item.sourceLang.split('-')[0].toUpperCase()}</span>
                </span>
                <button
                  onClick={handleCopyOriginal}
                  className="team-message-icon-btn"
                  title="Sao chép văn bản gốc"
                >
                  {copiedOriginal ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
                </button>
              </div>
              <p className="team-message-text team-message-text-original">{item.originalText}</p>

              <div className="team-message-separator" />

              <div className="team-message-langline">
                <span className="team-message-langchip team-message-langchip-accent">
                  Dịch · <span className="font-mono">{item.targetLang.split('-')[0].toUpperCase()}</span>
                </span>
                <button
                  className="team-message-icon-btn"
                  onClick={handleCopyTranslated}
                  title="Sao chép bản dịch"
                >
                  {copiedTranslated ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
                </button>
              </div>
              <p className="team-message-text team-message-text-translated">{item.translatedText}</p>

            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className={cardClassName}
    >
      {/* Top Meta Bar */}
      <div className="card-meta-bar" style={{ justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span>{item.timestamp}</span>
          <button
            onClick={() => onDelete(item.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              transition: 'color 0.2s',
            }}
            title="Xóa đoạn hội thoại"
            onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Side-by-side body layout */}
      <div className="card-body-grid">
        {/* Source Text Block */}
        <div className="card-content-block">
          <div className="block-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              Gốc · <Flag code={item.sourceLang} /> {getLanguageName(item.sourceLang)}
            </span>
            <button
              onClick={handleCopyOriginal}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              title="Sao chép văn bản gốc"
            >
              {copiedOriginal ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
            </button>
          </div>
          <p className="block-text">{item.originalText}</p>
          
          <div className="block-actions">
            <button
              className={`btn btn-secondary audio-play-btn ${isOriginalPlaying ? 'playing' : ''}`}
              onClick={() => speakOriginal(item.originalText, item.sourceLang, item.id)}
              disabled={!!playingCardId && !isOriginalPlaying}
              style={{
                borderColor: isOriginalPlaying ? 'var(--color-accent-indigo)' : undefined,
                color: isOriginalPlaying ? 'var(--color-accent-indigo)' : undefined,
              }}
            >
              <Volume2 size={12} className={isOriginalPlaying ? 'animate-pulse' : ''} />
              {isOriginalPlaying ? 'Đang phát...' : 'Nghe gốc'}
            </button>
            {copiedOriginal && <span className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--color-success)' }}>Đã sao chép ✓</span>}
          </div>
        </div>

        {/* Target Text Block */}
        <div className="card-content-block" style={{ borderLeft: '1px solid var(--border-color)' }}>
          <div className="block-title">
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <Sparkles size={11} style={{ color: 'var(--color-accent-teal)' }} />
              Dịch · <Flag code={item.targetLang} /> {getLanguageName(item.targetLang)}
            </span>
            <button
              onClick={handleCopyTranslated}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}
              title="Sao chép bản dịch"
            >
              {copiedTranslated ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
            </button>
          </div>
          <p className="block-text" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
            {item.translatedText}
          </p>

          <div className="block-actions">
            <button
              className={`btn btn-primary audio-play-btn ${isAIPlaying ? 'playing' : ''}`}
              onClick={() => speakAI(item.translatedText, item.targetLang, item.id)}
              disabled={!!playingCardId && !isAIPlaying}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                boxShadow: isAIPlaying ? '0 0 10px rgba(99, 102, 241, 0.4)' : undefined,
              }}
            >
              {isAILoading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Volume2 size={12} className={isAIPlaying ? 'animate-pulse' : ''} />
              )}
              {isAIPlaying ? 'Đang phát...' : 'Nghe AI'}
              {!isAIPlaying && !isAILoading && <span className="tts-badge-indicator">🎙️ Edge TTS Local</span>}
            </button>
            {copiedTranslated && <span className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--color-success)' }}>Đã sao chép ✓</span>}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
