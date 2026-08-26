import React from 'react';
import { Mic } from 'lucide-react';
import type { RecordingMode } from '../App';
import { CustomSelect } from './CustomSelect';

interface RecordingStationProps {
  mode: RecordingMode;
  setMode: (m: RecordingMode) => void;
  isLiveModelSelected: boolean;
  isActive: boolean;
  onStop: () => void;
  cabinInterval: number;
  setCabinInterval: (val: number) => void;
  liveSource: 'mic' | 'tab';
  setLiveSource: (src: 'mic' | 'tab') => void;
}

const MODE_OPTIONS: Array<{ value: RecordingMode; label: string; hint?: string }> = [
  { value: 'normal', label: 'Bình thường', hint: 'Thu rồi gửi đi dịch' },
  { value: 'cabin', label: 'Meeting Segment', hint: 'Tự cắt mỗi N giây' },
  { value: 'realtime', label: 'Real-time (Web Speech)', hint: 'Browser transcribe streaming' },
  { value: 'live', label: 'Live Translate (Gemini)' },
];

export const RecordingStation: React.FC<RecordingStationProps> = ({
  mode,
  setMode,
  isLiveModelSelected,
  isActive,
  onStop,
  cabinInterval,
  setCabinInterval,
  liveSource,
  setLiveSource,
}) => {
  const currentMode = MODE_OPTIONS.find((m) => m.value === mode);

  return (
    <div className="panel-card recording-station">
      <div className="recording-station-header">
        <h2>
          <Mic size={18} className="logo-icon" />
          Recording Station
        </h2>
      </div>

      <div className="mode-selector">
        <label className="mode-label">Chế độ thu âm</label>
        <CustomSelect
          className="mode-custom-select mode-recording-select"
          triggerClassName="model-select mode-select"
          menuClassName="mode-recording-menu"
          ariaLabel="Chọn chế độ thu âm"
          value={mode}
          options={MODE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            disabled: opt.value === 'live' ? !isLiveModelSelected : isLiveModelSelected,
          }))}
          onChange={(value) => {
            if (isActive) onStop();
            setMode(value as RecordingMode);
          }}
        />
        {currentMode?.hint && (
          <span className="mode-hint font-mono">{currentMode.hint}</span>
        )}
      </div>

      {mode === 'live' && (
        <div className="mode-selector">
          <label className="mode-label">Nguồn âm thanh</label>
          <CustomSelect
            className="mode-custom-select mode-source-select"
            triggerClassName="model-select mode-select"
            menuClassName="mode-source-menu"
            ariaLabel="Chọn nguồn âm thanh"
            value={liveSource}
            options={[
              { value: 'mic', label: 'Micro' },
              { value: 'tab', label: 'Âm thanh tab trình duyệt' },
            ]}
            onChange={(value) => {
              if (isActive) onStop();
              setLiveSource(value as 'mic' | 'tab');
            }}
          />
          <span className="mode-hint font-mono">
            {liveSource === 'tab'
              ? 'Chọn tab/cửa sổ và bật "Chia sẻ âm thanh"'
              : 'Thu trực tiếp từ micro'}
          </span>
        </div>
      )}

      {mode === 'cabin' && (
        <div className="cabin-interval-row">
          <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
            Chu kỳ:
          </span>
          <input
            type="number"
            min="5"
            max="60"
            value={cabinInterval}
            disabled={isActive}
            onChange={(e) => setCabinInterval(Math.max(5, parseInt(e.target.value) || 5))}
            className="input-control font-mono"
            style={{ width: '70px', padding: '0.3rem 0.5rem', textAlign: 'center' }}
          />
          <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            giây
          </span>
        </div>
      )}
    </div>
  );
};
