import React, { useEffect, useRef } from 'react';
import { Mic, Square } from 'lucide-react';
import type { RecordingMode, InputStyle } from '../App';

interface RecordButtonProps {
  mode: RecordingMode;
  inputStyle: InputStyle;
  pttKey: string;
  isActive: boolean;
  onStart: () => void;
  onStop: () => void;
  isTranslating: boolean;
}

export const RecordButton: React.FC<RecordButtonProps> = ({
  mode,
  inputStyle,
  pttKey,
  isActive,
  onStart,
  onStop,
  isTranslating,
}) => {
  const isPttActiveRef = useRef(false);

  // PTT only applies to 'normal' mode
  const usePtt = mode === 'normal' && inputStyle === 'ptt';

  // Mouse / touch PTT: also handle release outside the button
  useEffect(() => {
    const handleGlobalUp = () => {
      if (usePtt && isPttActiveRef.current) {
        isPttActiveRef.current = false;
        onStop();
      }
    };
    if (usePtt) {
      window.addEventListener('mouseup', handleGlobalUp);
      window.addEventListener('touchend', handleGlobalUp);
    }
    return () => {
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchend', handleGlobalUp);
    };
  }, [usePtt, onStop]);

  // Keyboard PTT: hold the configured key to record
  useEffect(() => {
    if (!usePtt) return;

    const isTypingTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== pttKey || e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (isPttActiveRef.current || isTranslating) return;
      e.preventDefault();
      isPttActiveRef.current = true;
      onStart();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey) return;
      if (!isPttActiveRef.current) return;
      e.preventDefault();
      isPttActiveRef.current = false;
      onStop();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [usePtt, pttKey, onStart, onStop, isTranslating]);

  const handlePttDown = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!usePtt || isActive || isTranslating) return;
    isPttActiveRef.current = true;
    onStart();
  };

  return (
    <div className="conversation-composer">
      {usePtt ? (
        <button
          className="btn btn-primary record-btn"
          style={{
            userSelect: 'none',
            background: isActive ? 'rgba(239, 68, 68, 0.3)' : undefined,
            borderColor: isActive ? 'rgba(239, 68, 68, 0.5)' : undefined,
            boxShadow: isActive ? '0 0 15px rgba(239, 68, 68, 0.3)' : undefined,
            cursor: isActive ? 'grabbing' : 'pointer',
          }}
          onMouseDown={handlePttDown}
          onTouchStart={handlePttDown}
          disabled={isTranslating}
        >
          <Mic size={18} />
          {isActive
            ? `Đang thu... Buông ${pttKey === 'Space' ? 'Space' : 'phím/chuột'} để dừng`
            : `Giữ chuột hoặc phím ${displayKey(pttKey)} để nói`}
        </button>
      ) : (
        <button
          className={`btn ${isActive ? 'btn-secondary' : 'btn-primary'} record-btn`}
          style={{
            fontWeight: 'bold',
            background: isActive ? 'rgba(239, 68, 68, 0.2)' : undefined,
            borderColor: isActive ? 'rgba(239, 68, 68, 0.4)' : undefined,
            color: isActive ? '#ef4444' : undefined,
            boxShadow: isActive ? '0 0 15px rgba(239, 68, 68, 0.25)' : undefined,
          }}
          onClick={isActive ? onStop : onStart}
          disabled={isTranslating}
        >
          {isActive ? (
            <>
              <Square size={18} fill="currentColor" />
              {labelForActive(mode)}
            </>
          ) : (
            <>
              <Mic size={18} />
              {labelForIdle(mode)}
            </>
          )}
        </button>
      )}

      {isTranslating && (
        <span
          className="font-mono"
          style={{ fontSize: '0.75rem', color: 'var(--color-accent-indigo)', animation: 'pulse 1.5s infinite' }}
        >
          Đang gửi văn bản dịch thuật...
        </span>
      )}
    </div>
  );
};

function displayKey(code: string): string {
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
}

function labelForIdle(mode: RecordingMode): string {
  switch (mode) {
    case 'cabin': return 'Bắt đầu thu cabin';
    case 'realtime': return 'Bắt đầu dịch trực tiếp';
    case 'live': return 'Bắt đầu Live Translate';
    default: return 'Bắt đầu thu âm';
  }
}

function labelForActive(mode: RecordingMode): string {
  switch (mode) {
    case 'cabin': return 'Dừng thu cabin';
    case 'realtime': return 'Dừng dịch trực tiếp';
    case 'live': return 'Dừng Live Translate';
    default: return 'Dừng ghi âm';
  }
}
