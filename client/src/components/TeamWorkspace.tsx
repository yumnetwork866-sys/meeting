import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  Clipboard,
  Languages,
  Loader2,
  Mic,
  Radio,
  Settings2,
  Square,
  Trash2,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { LanguageSelector, Flag, getLanguageName } from './LanguageSelector';
import { ModelSelector } from './ModelSelector';
import { TranscriptCard } from './TranscriptCard';
import { useTeamLive } from '../hooks/useTeamLive';
import type { TranscriptItem } from '../hooks/useTranslator';

interface TeamWorkspaceProps {
  userId: string;
  token: string | null;
  sourceLang: string;
  setSourceLang: (lang: string) => void;
  targetLang: string;
  setTargetLang: (lang: string) => void;
  model: string;
  onSaveModel: (model: string) => void;
  inputStyle: 'toggle' | 'ptt';
  pttKey: string;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  playingCardId: string | null;
  loadingCardId: string | null;
  speakOriginal: (text: string, language: string, cardId: string) => Promise<void>;
  speakAI: (text: string, language: string, cardId: string) => Promise<void>;
  onShowToast: (message: string) => void;
  onWaveStateChange?: (state: { isRecording: boolean; analyser: AnalyserNode | null }) => void;
  onConnectionChange?: (connected: boolean) => void;
  leaveRoomTick: number;
}

const NoopDelete = () => {};

function displayKey(code: string): string {
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
}

export const TeamWorkspace: React.FC<TeamWorkspaceProps> = ({
  userId,
  token,
  sourceLang,
  setSourceLang,
  targetLang,
  setTargetLang,
  model,
  onSaveModel,
  inputStyle,
  pttKey,
  voiceEnabled,
  onToggleVoice,
  playingCardId,
  loadingCardId,
  speakOriginal,
  speakAI,
  onShowToast,
  onWaveStateChange,
  onConnectionChange,
  leaveRoomTick,
}) => {
  const [joinId, setJoinId] = useState('');
  const [lobbyMode, setLobbyMode] = useState<'create' | 'join' | null>(null);
  const [languagePopupOpen, setLanguagePopupOpen] = useState(false);
  const [restoringRoomId, setRestoringRoomId] = useState('');
  const transcriptScrollerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const [recentRooms, setRecentRooms] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(`team_recent_rooms:${userId}`);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return Array.from(
        new Set(
          parsed
            .filter((roomId) => typeof roomId === 'string' && roomId.trim())
            .map((roomId) => roomId.trim().toUpperCase())
        )
      ).slice(0, 6);
    } catch {
      return [];
    }
  });
  const isPttActiveRef = useRef(false);
  const restoreAttemptRef = useRef(0);
  const restoreFailedRef = useRef(false);
  const restoredLanguageRef = useRef<string>('');
  const roomStorageKey = `team_last_room_id:${userId}`;
  const recentRoomsKey = `team_recent_rooms:${userId}`;
  const roomLanguageKey = useCallback((roomId: string) => `team_room_language:${userId}:${roomId}`, [userId]);
  const syncRoomUrl = useCallback((roomId: string) => {
    const url = new URL(window.location.href);
    if (roomId) url.searchParams.set('room', roomId);
    else url.searchParams.delete('room');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const clearRoomPersistence = useCallback((roomId?: string) => {
    localStorage.removeItem(roomStorageKey);
    sessionStorage.removeItem(roomStorageKey);
    if (roomId) localStorage.removeItem(roomLanguageKey(roomId));
    syncRoomUrl('');
  }, [roomLanguageKey, roomStorageKey, syncRoomUrl]);
  const abortRestore = useCallback((roomId?: string) => {
    restoreAttemptRef.current += 1;
    restoreFailedRef.current = true;
    setRestoringRoomId('');
    if (roomId) clearRoomPersistence(roomId);
  }, [clearRoomPersistence]);
  const upsertRecentRoom = useCallback((roomId: string) => {
    const normalized = roomId.trim().toUpperCase();
    if (!normalized) return;
    setRecentRooms((prev) => {
      const next = [normalized, ...prev.filter((item) => item !== normalized)].slice(0, 6);
      try {
        localStorage.setItem(recentRoomsKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [recentRoomsKey]);
  const removeRecentRoom = useCallback((roomId: string) => {
    const normalized = roomId.trim().toUpperCase();
    if (!normalized) return;
    setRecentRooms((prev) => {
      const next = prev.filter((item) => item !== normalized);
      try {
        localStorage.setItem(recentRoomsKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [recentRoomsKey]);
  const getInviteLink = useCallback((roomId: string) => {
    if (!roomId) return '';
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    return url.toString();
  }, []);

  const scrollToLatest = useCallback(() => {
    const el = transcriptScrollerRef.current;
    if (!el) return;
    window.requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, []);

  const team = useTeamLive({ token, voiceEnabled, onShowToast });
  const isThisClientSpeaking = team.activeSpeakerId === team.clientId && team.isSpeaking;
  const isThisClientFinalizing = team.activeSpeakerId === team.clientId && team.isStopping;
  const canSpeak = team.connected && (!team.activeSpeakerId || team.activeSpeakerId === team.clientId);
  const participantCount = team.participants.length;
  const languagePopupVisible = team.connected && (!team.myLanguage || languagePopupOpen);
  const usePtt = inputStyle === 'ptt';

  useEffect(() => {
    onWaveStateChange?.({
      isRecording: team.isSpeaking,
      analyser: team.isSpeaking ? team.analyser : null,
    });
  }, [onWaveStateChange, team.analyser, team.isSpeaking]);

  useEffect(() => {
    onConnectionChange?.(team.connected);
  }, [onConnectionChange, team.connected]);

  useEffect(() => {
    if (!team.connected || !team.roomId) return;
    restoreFailedRef.current = false;
    localStorage.setItem(roomStorageKey, team.roomId);
    sessionStorage.setItem(roomStorageKey, team.roomId);
    syncRoomUrl(team.roomId);
    upsertRecentRoom(team.roomId);
  }, [roomStorageKey, team.connected, team.roomId, syncRoomUrl, upsertRecentRoom]);

  useEffect(() => {
    if (!team.connected) return;
    const currentRoomId = team.roomId;
    team.disconnect();
    clearRoomPersistence(currentRoomId);
    setLanguagePopupOpen(false);
    isPttActiveRef.current = false;
    restoredLanguageRef.current = '';
    setRestoringRoomId('');
  }, [leaveRoomTick]); // intentionally only reacts to explicit leave requests

  useEffect(() => {
    if (team.connected) {
      setRestoringRoomId('');
      restoreFailedRef.current = false;
      return;
    }
    if (restoreFailedRef.current || restoringRoomId) return;

    const urlRoomId = new URL(window.location.href).searchParams.get('room') || '';
    const savedRoomId =
      urlRoomId ||
      sessionStorage.getItem(roomStorageKey) ||
      localStorage.getItem(roomStorageKey) ||
      '';
    if (!savedRoomId) return;

    const attempt = restoreAttemptRef.current + 1;
    restoreAttemptRef.current = attempt;
    setRestoringRoomId(savedRoomId);

    const timer = window.setTimeout(() => {
      if (restoreAttemptRef.current !== attempt || team.connected) return;
      void team.joinRoom(savedRoomId).catch(() => {
        if (restoreAttemptRef.current !== attempt) return;
        abortRestore(savedRoomId);
        onShowToast('Không nối lại được phòng đã lưu.');
      });
    }, 0);

    const timeout = window.setTimeout(() => {
      if (restoreAttemptRef.current !== attempt || team.connected) return;
      abortRestore(savedRoomId);
      onShowToast('Không nối lại được phòng đã lưu.');
    }, 8000);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
    };
  }, [abortRestore, onShowToast, roomStorageKey, team.connected, team.joinRoom]);

  useEffect(() => {
    if (lobbyMode !== 'join' || recentRooms.length === 0 || !token) return;

    let cancelled = false;
    const authHeaders = { Authorization: `Bearer ${token}` };

    void (async () => {
      const results = await Promise.all(
        recentRooms.map(async (roomId) => {
          try {
            const res = await fetch(`/api/team-live/rooms/${encodeURIComponent(roomId)}`, {
              headers: authHeaders,
            });
            if (!res.ok) return { roomId, open: false };
            const data = await res.json().catch(() => ({}));
            return { roomId, open: !!data.open };
          } catch {
            return { roomId, open: true };
          }
        })
      );

      if (cancelled) return;
      const next = results.filter((item) => item.open).map((item) => item.roomId);
      if (next.length === recentRooms.length && next.every((roomId, idx) => roomId === recentRooms[idx])) return;
      setRecentRooms(next);
      try {
        localStorage.setItem(recentRoomsKey, JSON.stringify(next));
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [lobbyMode, recentRooms, recentRoomsKey, token]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [team.roomId]);

  useEffect(() => {
    if (!team.connected || !team.roomId) return;
    if (!(team.isStarting || team.activeSpeakerId || team.interimSource || team.interimTarget)) return;
    shouldAutoScrollRef.current = true;
    scrollToLatest();
  }, [scrollToLatest, team.activeSpeakerId, team.connected, team.interimSource, team.interimTarget, team.isStarting, team.roomId]);

  useEffect(() => {
    if (!team.connected || !team.roomId || team.myLanguage) return;
    const savedLanguage = localStorage.getItem(roomLanguageKey(team.roomId));
    if (!savedLanguage || restoredLanguageRef.current === team.roomId) return;
    if (savedLanguage !== team.roomConfig.sourceLang && savedLanguage !== team.roomConfig.targetLang) return;
    restoredLanguageRef.current = team.roomId;
    team.setParticipantLanguage(savedLanguage);
  }, [roomLanguageKey, team.connected, team.myLanguage, team.roomConfig.sourceLang, team.roomConfig.targetLang, team.roomId, team.setParticipantLanguage]);

  const chooseLanguage = (lang: string) => {
    team.setParticipantLanguage(lang);
    if (team.roomId) {
      localStorage.setItem(roomLanguageKey(team.roomId), lang);
      restoredLanguageRef.current = team.roomId;
    }
    setLanguagePopupOpen(false);
  };

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
      if (isPttActiveRef.current || team.isStarting || team.isStopping || !canSpeak || !team.myLanguage) return;
      e.preventDefault();
      isPttActiveRef.current = true;
      void team.startSpeaking('mic');
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== pttKey) return;
      if (!isPttActiveRef.current) return;
      e.preventDefault();
      isPttActiveRef.current = false;
      team.stopSpeaking();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [canSpeak, pttKey, team, usePtt]);

  const createRoom = async () => {
    if (sourceLang === targetLang) {
      onShowToast('⚠️ Hãy chọn hai ngôn ngữ khác nhau cho phòng.');
      return;
    }
    try {
      await team.createRoom({ sourceLang, targetLang, model });
    } catch (err: any) {
      onShowToast(`Không tạo được phòng: ${err?.message || 'lỗi không xác định'}`);
    }
  };

  const joinRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!joinId.trim()) return;
    try {
      await team.joinRoom(joinId);
    } catch (err: any) {
      onShowToast(`Không vào được phòng: ${err?.message || 'lỗi không xác định'}`);
    }
  };

  const copyRoomId = async () => {
    if (!team.roomId) return;
    try {
      await navigator.clipboard.writeText(team.roomId);
      onShowToast('Đã sao chép mã phòng.');
    } catch {
      onShowToast('Không sao chép được mã phòng.');
    }
  };

  const copyInviteLink = async () => {
    if (!team.roomId) return;
    try {
      await navigator.clipboard.writeText(getInviteLink(team.roomId));
      onShowToast('Đã sao chép link mời.');
    } catch {
      onShowToast('Không sao chép được link mời.');
    }
  };

  useEffect(() => {
    if (!team.connected || !team.roomId) return;
    if (!shouldAutoScrollRef.current) return;
    scrollToLatest();
  }, [scrollToLatest, team.connected, team.roomId, team.transcripts.length]);

  const handleTranscriptScroll = () => {
    const el = transcriptScrollerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 120;
  };

  if (!team.connected) {
    if (restoringRoomId) {
      return (
        <div className="team-lobby">
          <section className="team-join-panel panel-card">
            <div className="team-lobby-header" />
            <div className="empty-state team-empty-state">
              <Loader2 size={42} className="animate-spin empty-state-icon" />
              <h3>Đang nối lại phòng</h3>
              <p>{restoringRoomId}</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => abortRestore(restoringRoomId)}
              >
                Bỏ qua và vào lobby
              </button>
            </div>
          </section>
        </div>
      );
    }
    return (
      <div className="team-lobby">
        <section className="team-join-panel panel-card">
          <div className="team-lobby-header">
          </div>

          <div className="team-choice-grid" aria-label="Chọn cách vào phòng Team">
            <button
              type="button"
              className={`team-choice-card ${lobbyMode === 'create' ? 'active' : ''}`}
              onClick={() => setLobbyMode('create')}
            >
              <Radio size={22} />
              <strong>Tạo phòng mới</strong>
              <span>Thiết lập ngôn ngữ, model, chia sẻ mã phòng.</span>
            </button>
            <button
              type="button"
              className={`team-choice-card ${lobbyMode === 'join' ? 'active' : ''}`}
              onClick={() => setLobbyMode('join')}
            >
              <UserPlus size={22} />
              <strong>Tham gia</strong>
              <span>Tham gia vào phòng có sẵn.</span>
            </button>
          </div>

          {lobbyMode === 'create' && (
            <div className="team-lobby-controls">
              <div className="team-lobby-subtitle">
                <Settings2 size={14} />
                <strong>Cấu hình phòng</strong>
              </div>
              <ModelSelector model={model} onSaveModel={onSaveModel} />
              <LanguageSelector
                sourceLang={sourceLang}
                setSourceLang={setSourceLang}
                targetLang={targetLang}
                setTargetLang={setTargetLang}
                compact
              />
              <button type="button" className="btn btn-primary team-wide-btn" onClick={createRoom}>
                <Radio size={16} />
                Tạo phòng
              </button>
            </div>
          )}

          {lobbyMode === 'join' && (
            <form className="team-join-form" onSubmit={joinRoom}>
              <div className="input-group">
                <label className="input-label">Mã phòng</label>
                <input
                  className="input-control"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value.toUpperCase())}
                  placeholder="ABC123"
                  maxLength={12}
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={!joinId.trim()}>
                <UserPlus size={16} />
                Tham gia
              </button>
            </form>
          )}

          {lobbyMode === 'join' && recentRooms.length > 0 && (
            <section className="team-recent-rooms">
              <div className="team-lobby-subtitle">
                <Users size={14} />
                <strong>Phòng gần đây</strong>
              </div>
              <div className="team-recent-room-list">
                {recentRooms.map((roomId) => (
                  <div key={roomId} className="team-recent-room-item">
                      <strong className="team-room-id">{roomId}</strong>
                    <div className="team-recent-room-actions">
                      <button
                        type="button"
                        className="btn btn-secondary team-recent-room-btn"
                        onClick={() => {
                          void team.joinRoom(roomId).catch((err: any) => {
                            onShowToast(`Không vào được phòng: ${err?.message || 'lỗi không xác định'}`);
                          });
                        }}
                      >
                      <span>Vào phòng</span>
                      </button>
                      <button
                        type="button"
                        className="topbar-icon-btn"
                        onClick={() => removeRecentRoom(roomId)}
                        title="Xóa khỏi danh sách"
                        aria-label={`Xóa phòng ${roomId} khỏi danh sách gần đây`}
                      >
                        <Trash2 size={14} />
                      </button>
                      <button
                        type="button"
                        className="topbar-icon-btn"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(getInviteLink(roomId));
                            onShowToast('Đã sao chép link mời.');
                          } catch {
                            onShowToast('Không sao chép được link mời.');
                          }
                        }}
                        title="Sao chép link mời"
                      >
                        <Clipboard size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </section>
      </div>
    );
  }

  return (
    <div className="team-workspace">
      {languagePopupVisible && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (team.myLanguage) setLanguagePopupOpen(false);
          }}
        >
          <div
            className="modal-card team-language-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="team-language-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <Languages size={18} className="logo-icon" />
              <h3 id="team-language-title" className="modal-title">Chọn ngôn ngữ của bạn</h3>
            </div>
            <div className="settings-radio-group team-language-modal-grid">
              {[team.roomConfig.sourceLang, team.roomConfig.targetLang].map((lang) => {
                const target = lang === team.roomConfig.sourceLang ? team.roomConfig.targetLang : team.roomConfig.sourceLang;
                return (
                  <button
                    key={lang}
                    type="button"
                    className={`settings-radio ${team.myLanguage === lang ? 'active' : ''}`}
                    onClick={() => chooseLanguage(lang)}
                    disabled={team.isSpeaking}
                  >
                    <strong>
                      <Flag code={lang} /> {getLanguageName(lang)}
                    </strong>
                    <span>Dịch sang {getLanguageName(target)}</span>
                  </button>
                );
              })}
            </div>
            {team.myLanguage && (
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setLanguagePopupOpen(false)}>
                  Đóng
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="team-grid">
        <aside className="team-sidebar panel-card">
          <section className="team-participants">
            <div className="team-section-title">
              <Users size={16} className="logo-icon" />
              <h3>Thành viên</h3>
              <span className="transcript-count">{participantCount}</span>
            </div>
            <div className="team-participant-list">
              {team.participants.map((participant) => (
                <div key={participant.id} className={`team-participant-row ${participant.isSpeaker ? 'speaking' : ''}`}>
                  <span className="team-avatar">{participant.username.slice(0, 1).toUpperCase()}</span>
                  <span>{participant.username}</span>
                  {participant.language && (
                    <span className="team-self-chip">
                      <Flag code={participant.language} /> {participant.language.split('-')[0].toUpperCase()}
                    </span>
                  )}
                  {participant.id === team.clientId && <span className="team-self-chip">Bạn</span>}
                </div>
              ))}
            </div>
          </section>
        </aside>

        <section className="team-transcript-panel">
          <div className="team-transcript-header">
            <div className="transcript-header-left">
              <div className="team-room-id-row team-room-id-inline">
                <div>
                  <span className="settings-label">Mã phòng</span>
                  <strong className="team-room-id">{team.roomId}</strong>
                </div>
                <button className="topbar-icon-btn" onClick={copyRoomId} title="Sao chép mã phòng">
                  <Clipboard size={15} />
                </button>
                <button className="topbar-icon-btn" onClick={copyInviteLink} title="Sao chép link mời">
                  <UserPlus size={15} />
                </button>
              </div>
            </div>
            <div className="transcript-header-center">
              <div className="team-lang-route">
                <Languages size={14} />
                <span><Flag code={team.roomConfig.sourceLang} /> {getLanguageName(team.roomConfig.sourceLang)}</span>
                <span className="team-route-arrow">↔</span>
                <span><Flag code={team.roomConfig.targetLang} /> {getLanguageName(team.roomConfig.targetLang)}</span>
              </div>
            </div>
            <div className="team-transcript-actions transcript-header-controls">
              <button
                type="button"
                className={`btn btn-secondary icon-only-btn ${voiceEnabled ? 'voice-on' : ''}`}
                title={voiceEnabled ? 'Tắt giọng đọc' : 'Bật giọng đọc'}
                aria-pressed={voiceEnabled}
                onClick={onToggleVoice}
              >
                {voiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              </button>
            </div>
          </div>

          <div
            className="transcript-scroller team-transcript-scroller"
            ref={transcriptScrollerRef}
            onScroll={handleTranscriptScroll}
          >
            {team.transcripts.length === 0 && !team.activeSpeakerId ? (
              <div className="empty-state team-empty-state">
                <Users size={48} className="empty-state-icon" />
                <h3>Đang chờ giọng nói trong phòng</h3>
                <p>Bắt đầu nói hoặc chia sẻ mã phòng cho người khác.</p>
              </div>
            ) : (
              <AnimatePresence initial={false}>
                {team.transcripts.map((item: TranscriptItem) => (
                  <TranscriptCard
                    key={item.id}
                    item={item}
                    onDelete={team.deleteTranscript || NoopDelete}
                    speakOriginal={speakOriginal}
                    speakAI={speakAI}
                    playingCardId={playingCardId}
                    loadingCardId={loadingCardId}
                    variant="team"
                  />
                ))}
              </AnimatePresence>
            )}

            {(team.interimSource || team.interimTarget || team.activeSpeakerId) && (
              <div className="transcript-card live-preview team-live-preview">
                <div className="card-meta-bar">
                  <span className="font-mono">
                    <span className="live-dot" /> {team.activeSpeakerName || 'Người nói'}
                  </span>
                </div>
                <div className="card-body-grid" style={{ gridTemplateColumns: '1fr' }}>
                  <div className="card-content-block">
                    <div className="block-title">
                      <Flag code={team.currentSourceLang} />
                      <span className="font-mono">{team.currentSourceLang.split('-')[0].toUpperCase()}</span>
                    </div>
                    <p className="block-text">{team.interimSource || 'Đang nghe...'}</p>
                  </div>
                  <div className="card-content-block" style={{ borderTop: '1px solid var(--border-color)' }}>
                    <div className="block-title">
                      <Flag code={team.currentTargetLang} />
                      <span className="font-mono">{team.currentTargetLang.split('-')[0].toUpperCase()}</span>
                    </div>
                    <p className="block-text">{team.interimTarget || 'Đang dịch...'}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="conversation-composer team-conversation-composer">
            {usePtt ? (
              <button
                type="button"
                className="btn btn-primary record-btn"
                style={{
                  background: (isThisClientSpeaking || isThisClientFinalizing) ? 'rgba(239, 68, 68, 0.3)' : undefined,
                  borderColor: (isThisClientSpeaking || isThisClientFinalizing) ? 'rgba(239, 68, 68, 0.5)' : undefined,
                  boxShadow: (isThisClientSpeaking || isThisClientFinalizing) ? '0 0 15px rgba(239, 68, 68, 0.3)' : undefined,
                }}
                disabled={team.isStarting || team.isStopping || !canSpeak || !team.myLanguage}
              >
                {team.isStarting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : team.isStopping ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Mic size={18} />
                )}
                {team.isStopping
                  ? 'Đang chốt...'
                  : isThisClientSpeaking
                    ? `Đang thu... Nhả ${displayKey(pttKey)} để dừng`
                    : `Giữ phím ${displayKey(pttKey)} để nói`}
              </button>
            ) : (
              <button
                type="button"
                className={`btn ${(isThisClientSpeaking || isThisClientFinalizing) ? 'btn-secondary' : 'btn-primary'} record-btn`}
                style={{
                  fontWeight: 'bold',
                  background: (isThisClientSpeaking || isThisClientFinalizing) ? 'rgba(239, 68, 68, 0.2)' : undefined,
                  borderColor: (isThisClientSpeaking || isThisClientFinalizing) ? 'rgba(239, 68, 68, 0.4)' : undefined,
                  color: (isThisClientSpeaking || isThisClientFinalizing) ? '#ef4444' : undefined,
                  boxShadow: (isThisClientSpeaking || isThisClientFinalizing) ? '0 0 15px rgba(239, 68, 68, 0.25)' : undefined,
                }}
                onClick={() => {
                  if (isThisClientSpeaking) team.stopSpeaking();
                  else void team.startSpeaking('mic');
                }}
                disabled={!canSpeak || team.isStarting || team.isStopping || !team.myLanguage}
              >
                {team.isStarting ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : team.isStopping ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : isThisClientSpeaking ? (
                  <Square size={18} fill="currentColor" />
                ) : (
                  <Mic size={18} />
                )}
                {team.isStopping
                  ? 'Đang chốt...'
                  : isThisClientSpeaking
                    ? 'Dừng nói'
                    : team.myLanguage ? 'Bắt đầu nói' : 'Chọn ngôn ngữ trước'}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
