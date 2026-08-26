import React, { useState, useEffect, useRef } from 'react';
import { useTranslator } from './hooks/useTranslator';
import { useSessions } from './hooks/useSessions';
import { useRecorder } from './hooks/useRecorder';
import { useEdgeTTS } from './hooks/useEdgeTTS';
import { useRealtimeTranslator } from './hooks/useRealtimeTranslator';
import { useLiveTranslate } from './hooks/useLiveTranslate';
import { useAuth, type AuthUser } from './hooks/useAuth';
import { RecordingStation } from './components/RecordingStation';
import { RecordButton } from './components/RecordButton';
import { WaveAnimation } from './components/WaveAnimation';
import { TranscriptList } from './components/TranscriptList';
import { SessionSidebar } from './components/SessionSidebar';
import { ConfirmProvider } from './components/ConfirmDialog';
import { LoginPage } from './components/LoginPage';
import { AdminDashboard } from './components/AdminDashboard';
import { ConversationHistoryPage } from './components/ConversationHistoryPage';
import { TeamWorkspace } from './components/TeamWorkspace';
import { CheckCircle2, AlertTriangle, LogOut, User, Users, ClipboardList, Loader2, Settings as SettingsIcon, X, Activity, RefreshCw, ShieldCheck, ChevronDown, History, Sparkles } from 'lucide-react';

export type RecordingMode = 'normal' | 'cabin' | 'realtime' | 'live';
export type InputStyle = 'toggle' | 'ptt';

export const App: React.FC = () => {
  const { token, user, loading, login, register, resetPassword, changePassword, logout } = useAuth();

  if (loading) {
    return (
      <div className="login-shell">
        <Loader2 size={32} className="animate-spin logo-icon" />
      </div>
    );
  }

  if (!token || !user) {
    return <LoginPage onLogin={login} onRegister={register} onReset={resetPassword} />;
  }

  if (user.mustChangePassword) {
    return <ForcePasswordChangePage username={user.username} onChangePassword={changePassword} onLogout={logout} />;
  }

  return <AuthedApp token={token} user={user} onLogout={logout} />;
};

interface AppBrandButtonProps {
  onClick: () => void;
}

const AppBrandButton: React.FC<AppBrandButtonProps> = ({ onClick }) => (
  <button type="button" className="app-brand-button" onClick={onClick} aria-label="Về trang chủ SpeakLink">
    <Sparkles size={18} className="logo-icon" />
    <span className="app-title">SpeakLink</span>
  </button>
);

interface ForcePasswordChangePageProps {
  username: string;
  onChangePassword: (password: string) => Promise<unknown>;
  onLogout: () => void;
}

const ForcePasswordChangePage: React.FC<ForcePasswordChangePageProps> = ({
  username,
  onChangePassword,
  onLogout,
}) => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password tối thiểu 6 ký tự.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Xác nhận password không khớp.');
      return;
    }
    setSubmitting(true);
    try {
      await onChangePassword(password);
    } catch (err: any) {
      setError(err?.message || 'Đổi mật khẩu thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card panel-card" onSubmit={submit}>
        <div className="login-brand">
          <ShieldCheck size={32} className="logo-icon" />
          <div>
            <h1 className="app-title" style={{ fontSize: '1.5rem' }}>Đổi mật khẩu</h1>
            <p className="login-hint font-mono">{username}</p>
          </div>
        </div>
        <div className="input-group">
          <label className="input-label">Mật khẩu mới</label>
          <input
            type="password"
            className="input-control"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            disabled={submitting}
            autoFocus
          />
        </div>
        <div className="input-group">
          <label className="input-label">Xác nhận mật khẩu</label>
          <input
            type="password"
            className="input-control"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            disabled={submitting}
          />
        </div>
        {error && <div className="login-error font-mono">{error}</div>}
        <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
          {submitting && <Loader2 size={16} className="animate-spin" />}
          Cập nhật mật khẩu
        </button>
        <button type="button" className="logout-btn settings-logout" onClick={onLogout}>
          <LogOut size={14} />
          Đăng xuất
        </button>
      </form>
    </div>
  );
};

interface AuthedAppProps {
  token: string;
  user: AuthUser;
  onLogout: () => void;
}

const AuthedApp: React.FC<AuthedAppProps> = ({ token, user, onLogout }) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState(() => window.location.pathname);
  const [sourceLang, setSourceLang] = useState('en-US');
  const [targetLang, setTargetLang] = useState('vi-VN');
  const [mode, setMode] = useState<RecordingMode>('normal');
  const [inputStyle, setInputStyle] = useState<InputStyle>(() => {
    const stored = localStorage.getItem('input_style');
    return stored === 'ptt' ? 'ptt' : 'toggle';
  });
  const [pttKey, setPttKey] = useState<string>(
    () => localStorage.getItem('ptt_key') || 'Space'
  );
  const [liveSource, setLiveSource] = useState<'mic' | 'tab'>(
    () => (localStorage.getItem('live_source') === 'tab' ? 'tab' : 'mic')
  );
  const [liveVoiceEnabled, setLiveVoiceEnabled] = useState<boolean>(
    () => localStorage.getItem('live_voice') !== 'off'
  );
  const [showSettings, setShowSettings] = useState(false);
  const [leaveRoomTick, setLeaveRoomTick] = useState(0);
  const [teamConnected, setTeamConnected] = useState(false);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (window.location.pathname === '/admin/transcripts') {
      navigateTo('/admin/users');
    }
  }, []);

  const navigateTo = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
    }
    setCurrentPath(path);
    setShowSettings(false);
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage((prev) => (prev === message ? null : prev));
    }, 4000);
  };

  const {
    sessions,
    activeId,
    transcripts,
    loading: sessionsLoading,
    ensureActiveSession,
    createSession,
    selectSession,
    renameSession,
    deleteSession,
    addTranscriptItem,
    deleteTranscript,
    exportSession,
  } = useSessions({ token, userId: user.id, onShowToast: showToast });

  const {
    apiKey,
    saveApiKey,
    isKeyValid,
    keyError,
    checkApiKey,
    ttsStatus,
    checkEdgeTTS,
    isTranslating,
    translateAudio,
    translateText,
    model,
    saveModel,
  } = useTranslator({ onShowToast: showToast, token, onTranscript: addTranscriptItem });

  const {
    loadingCardId,
    playingCardId,
    speakOriginal,
    speakAI,
    stopSpeaking,
  } = useEdgeTTS({ onShowToast: showToast });

  const {
    isRecording,
    startRecording,
    stopRecording,
    setCabinMode,
    cabinInterval,
    setCabinInterval,
    analyser,
  } = useRecorder({
    onAudioReady: async (base64Audio, mimeType, transcribedText) => {
      if (transcribedText) {
        try {
          const translated = await translateText(transcribedText, sourceLang, targetLang);
          addTranscriptItem(transcribedText, translated, sourceLang, targetLang);
        } catch (err) {
          console.warn('Failed to translate local transcription, falling back to audio upload...', err);
          translateAudio(base64Audio, mimeType, sourceLang, targetLang);
        }
      } else {
        translateAudio(base64Audio, mimeType, sourceLang, targetLang);
      }
    },
    onError: (msg) => {
      showToast(`❌ Lỗi mic: ${msg}`);
    },
  });

  const {
    setRealtimeMode,
    isListening,
    startListening,
    stopListening,
    interimText,
    isTranslatingRealtime,
  } = useRealtimeTranslator({
    sourceLang,
    targetLang,
    translateText,
    addTranscriptItem,
    onShowToast: showToast,
  });

  // Live API mode (audio<->audio streaming via Google Live API)
  const isLiveModelSelected = /live/i.test(model);
  const {
    isLive,
    startLive,
    stopLive,
    interimSource,
    interimTarget,
    analyser: liveAnalyser,
  } = useLiveTranslate({
    token,
    sourceLang,
    targetLang,
    model,
    voiceEnabled: liveVoiceEnabled,
    onTurnComplete: addTranscriptItem,
    onShowToast: showToast,
  });

  // Lock mode to 'live' when a live model is selected; restore otherwise.
  useEffect(() => {
    if (isLiveModelSelected && mode !== 'live') setMode('live');
    else if (!isLiveModelSelected && mode === 'live') setMode('normal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveModelSelected]);

  // Persist input style + ptt key preferences
  useEffect(() => {
    localStorage.setItem('input_style', inputStyle);
  }, [inputStyle]);

  useEffect(() => {
    localStorage.setItem('live_source', liveSource);
  }, [liveSource]);

  useEffect(() => {
    localStorage.setItem('live_voice', liveVoiceEnabled ? 'on' : 'off');
  }, [liveVoiceEnabled]);

  useEffect(() => {
    localStorage.setItem('ptt_key', pttKey);
  }, [pttKey]);

  // Sync the unified mode -> hook-internal flags (cabin / realtime).
  useEffect(() => {
    setCabinMode(mode === 'cabin');
    setRealtimeMode(mode === 'realtime');
  }, [mode, setCabinMode, setRealtimeMode]);

  useEffect(() => {
    if (isRecording) {
      stopSpeaking();
      stopListening();
      stopLive();
    }
  }, [isRecording]);

  useEffect(() => {
    if (isListening) {
      stopSpeaking();
      if (isRecording) stopRecording();
      stopLive();
    }
  }, [isListening]);

  useEffect(() => {
    if (isLive) {
      stopSpeaking();
      if (isRecording) stopRecording();
      stopListening();
    }
  }, [isLive]);

  const handleStart = async () => {
    const sessionId = await ensureActiveSession();
    if (!sessionId) return;

    if (mode === 'live') {
      await startLive(liveSource);
      return;
    }
    if (mode === 'realtime') {
      startListening();
      return;
    }
    await startRecording(sourceLang);
  };

  const keyDot =
    isKeyValid === 'valid' ? 'ok' :
    isKeyValid === 'invalid' ? 'err' :
    isKeyValid === 'checking' ? 'pending' : 'idle';

  const isActive =
    mode === 'live' ? isLive : mode === 'realtime' ? isListening : isRecording;
  const activeAnalyser = mode === 'live' ? liveAnalyser : analyser;
  const handleStop =
    mode === 'live' ? stopLive : mode === 'realtime' ? stopListening : stopRecording;
  const isAdminPage = currentPath === '/admin' || currentPath.startsWith('/admin/');
  const isTeamPage = currentPath === '/team';
  const isHistoryPage = currentPath === '/history';
  const adminSection =
    currentPath === '/admin/audit' ? 'audit' :
    currentPath === '/admin/settings' ? 'settings' :
    'users';

  const appTopbarTitle = (
    <div className="app-title-section app-topbar-title-section">
      <AppBrandButton onClick={() => navigateTo('/')} />
    </div>
  );

  const [teamTopbarWave, setTeamTopbarWave] = useState<{ isRecording: boolean; analyser: AnalyserNode | null }>({
    isRecording: false,
    analyser: null,
  });

  const topbarWaveIsRecording = isTeamPage ? teamTopbarWave.isRecording : isActive;
  const topbarWaveAnalyser = isTeamPage ? teamTopbarWave.analyser : activeAnalyser;

  const appTopbarContent = (
    <>
      <WaveAnimation isRecording={topbarWaveIsRecording} analyser={topbarWaveAnalyser} className="topbar-wave" />
      <div className="app-topbar-settings">
        <span className="user-chip topbar-user-chip" title="Tài khoản đang đăng nhập">
          <User size={12} />
          <strong>{user.username}</strong>
        </span>
        <button
          className="status-pill-group topbar-status"
          onClick={() => setShowSettings((v) => !v)}
          title="Trạng thái kết nối — bấm để mở cài đặt"
        >
          <span className={`status-pill ${keyDot}`}>API</span>
        </button>
        <button
          className="topbar-icon-btn"
          onClick={() => setShowSettings((v) => !v)}
          title="Cài đặt"
          aria-expanded={showSettings}
        >
          <SettingsIcon size={16} />
        </button>

        {showSettings && (
          <SettingsPopover
            apiKey={apiKey}
            onSaveKey={saveApiKey}
            isKeyValid={isKeyValid}
            keyError={keyError}
            onCheckKey={checkApiKey}
            ttsStatus={ttsStatus}
            onCheckTTS={checkEdgeTTS}
            model={model}
            inputStyle={inputStyle}
            setInputStyle={setInputStyle}
            pttKey={pttKey}
            setPttKey={setPttKey}
            showLeaveRoom={isTeamPage && teamConnected}
            onLeaveRoom={() => {
              setShowSettings(false);
              setLeaveRoomTick((v) => v + 1);
            }}
            onLogout={onLogout}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>
    </>
  );

  if (isAdminPage) {
    return (
      <ConfirmProvider>
        <AppShell user={user} currentPath={currentPath} onNavigate={navigateTo} onLogout={onLogout}>
          <div className="app-container admin-page-container">
            <header className="app-header">
              <div className="app-title-section">
                <AppBrandButton onClick={() => navigateTo('/')} />
              </div>
              <span className="user-chip">
                <User size={12} />
                <strong>{user.username}</strong>
              </span>
            </header>

            {user.isAdmin ? (
              <AdminDashboard
                token={token}
                currentUserId={user.id}
                onClose={() => navigateTo('/')}
                onShowToast={showToast}
                section={adminSection}
                variant="page"
              />
            ) : (
              <div className="admin-denied panel-card">
                <ShieldCheck size={28} className="logo-icon" />
                <h2>Không có quyền truy cập</h2>
                <p>Chỉ tài khoản admin mới mở được dashboard này.</p>
                <button className="btn btn-primary" onClick={() => navigateTo('/')}>
                  Về trang chính
                </button>
              </div>
            )}

            {toastMessage && (
              <div className="toast">
                {toastMessage.includes('❌') || toastMessage.includes('Lỗi') ? (
                  <AlertTriangle size={16} style={{ color: 'var(--color-error)' }} />
                ) : (
                  <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
                )}
                <span style={{ fontSize: '0.85rem' }}>{toastMessage}</span>
              </div>
            )}
          </div>
        </AppShell>
      </ConfirmProvider>
    );
  }

  if (isTeamPage) {
    return (
      <ConfirmProvider>
        <AppShell
          user={user}
          currentPath={currentPath}
          onNavigate={navigateTo}
          onLogout={onLogout}
          topbarTitle={appTopbarTitle}
          topbarContent={appTopbarContent}
        >
          <div className="app-container team-mode-container">
            <TeamWorkspace
              userId={user.id}
              token={token}
              sourceLang={sourceLang}
              setSourceLang={setSourceLang}
              targetLang={targetLang}
              setTargetLang={setTargetLang}
              model={model}
              onSaveModel={saveModel}
              inputStyle={inputStyle}
              pttKey={pttKey}
              voiceEnabled={liveVoiceEnabled}
              onToggleVoice={() => setLiveVoiceEnabled((v) => !v)}
              playingCardId={playingCardId}
              loadingCardId={loadingCardId}
              speakOriginal={speakOriginal}
              speakAI={speakAI}
              onShowToast={showToast}
              onWaveStateChange={setTeamTopbarWave}
              leaveRoomTick={leaveRoomTick}
              onConnectionChange={setTeamConnected}
            />

            {toastMessage && (
              <div className="toast">
                {toastMessage.includes('❌') || toastMessage.includes('Lỗi') ? (
                  <AlertTriangle size={16} style={{ color: 'var(--color-error)' }} />
                ) : (
                  <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
                )}
                <span style={{ fontSize: '0.85rem' }}>{toastMessage}</span>
              </div>
            )}
          </div>
        </AppShell>
      </ConfirmProvider>
    );
  }

  if (isHistoryPage) {
    return (
      <ConfirmProvider>
        <AppShell
          user={user}
          currentPath={currentPath}
          onNavigate={navigateTo}
          onLogout={onLogout}
          topbarTitle={appTopbarTitle}
          topbarContent={appTopbarContent}
        >
          <ConversationHistoryPage token={token} onShowToast={showToast} />

          {toastMessage && (
            <div className="toast">
              {toastMessage.includes('❌') || toastMessage.includes('Lỗi') ? (
                <AlertTriangle size={16} style={{ color: 'var(--color-error)' }} />
              ) : (
                <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
              )}
              <span style={{ fontSize: '0.85rem' }}>{toastMessage}</span>
            </div>
          )}
        </AppShell>
      </ConfirmProvider>
    );
  }

  return (
    <ConfirmProvider>
    <AppShell
      user={user}
      currentPath={currentPath}
      onNavigate={navigateTo}
      onLogout={onLogout}
      topbarTitle={appTopbarTitle}
      topbarContent={appTopbarContent}
    >
    <div className="app-container">
      <div className="dashboard-grid">
        <div className="sidebar-col">
          <SessionSidebar
            sessions={sessions}
            activeId={activeId}
            onSelect={selectSession}
            onCreate={createSession}
            onRename={renameSession}
            onDelete={deleteSession}
            onExport={exportSession}
          />
          <RecordingStation
            mode={mode}
            setMode={setMode}
            isLiveModelSelected={isLiveModelSelected}
            isActive={isActive}
            onStop={handleStop}
            cabinInterval={cabinInterval}
            setCabinInterval={setCabinInterval}
            liveSource={liveSource}
            setLiveSource={setLiveSource}
          />
        </div>

        <div className="content-col">
          <div className="transcript-panel">
            <TranscriptList
              transcripts={transcripts}
              loading={sessionsLoading}
              onDelete={deleteTranscript}
              speakOriginal={speakOriginal}
              speakAI={speakAI}
              playingCardId={playingCardId}
              loadingCardId={loadingCardId}
              interimSource={mode === 'live' ? interimSource : interimText}
              interimTarget={mode === 'live' ? interimTarget : ''}
              isTranslatingRealtime={mode === 'live' ? isLive : isTranslatingRealtime}
              sourceLang={sourceLang}
              setSourceLang={setSourceLang}
              targetLang={targetLang}
              setTargetLang={setTargetLang}
              model={model}
              onSaveModel={saveModel}
              isLiveMode={mode === 'live'}
              voiceEnabled={liveVoiceEnabled}
              onToggleVoice={() => setLiveVoiceEnabled((v) => !v)}
            />
            <RecordButton
              mode={mode}
              inputStyle={inputStyle}
              pttKey={pttKey}
              isActive={isActive}
              onStart={() => void handleStart()}
              onStop={handleStop}
              isTranslating={isTranslating}
            />
          </div>
        </div>
      </div>

      {toastMessage && (
        <div className="toast">
          {toastMessage.includes('❌') || toastMessage.includes('Lỗi') ? (
            <AlertTriangle size={16} style={{ color: 'var(--color-error)' }} />
          ) : (
            <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
          )}
          <span style={{ fontSize: '0.85rem' }}>{toastMessage}</span>
        </div>
      )}
    </div>
    </AppShell>
    </ConfirmProvider>
  );
};

interface AppShellProps {
  user: AuthUser;
  currentPath: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  topbarTitle?: React.ReactNode;
  topbarContent?: React.ReactNode;
  children: React.ReactNode;
}

const AppShell: React.FC<AppShellProps> = ({ user, currentPath, onNavigate, topbarTitle, topbarContent, children }) => {
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const modeCloseTimerRef = useRef<number | null>(null);
  const adminCloseTimerRef = useRef<number | null>(null);
  const isHome = currentPath === '/';
  const isTeam = currentPath === '/team';
  const isHistory = currentPath === '/history';
  const isMode = isHome || isTeam;
  const activeModeLabel = isTeam ? 'Team' : isHome ? 'Personal' : 'Personal';
  const isAdmin = currentPath === '/admin' || currentPath.startsWith('/admin/');
  const isAdminUsers = currentPath === '/admin' || currentPath === '/admin/users';
  const isAdminAudit = currentPath === '/admin/audit';
  const isAdminSettings = currentPath === '/admin/settings';

  const navigateAndClose = (path: string) => {
    if (modeCloseTimerRef.current !== null) {
      window.clearTimeout(modeCloseTimerRef.current);
      modeCloseTimerRef.current = null;
    }
    if (adminCloseTimerRef.current !== null) {
      window.clearTimeout(adminCloseTimerRef.current);
      adminCloseTimerRef.current = null;
    }
    setModeMenuOpen(false);
    setAdminMenuOpen(false);
    onNavigate(path);
  };

  const openModeMenu = () => {
    if (modeCloseTimerRef.current !== null) {
      window.clearTimeout(modeCloseTimerRef.current);
      modeCloseTimerRef.current = null;
    }
    setModeMenuOpen(true);
  };

  const closeModeMenuSoon = () => {
    if (modeCloseTimerRef.current !== null) {
      window.clearTimeout(modeCloseTimerRef.current);
    }
    modeCloseTimerRef.current = window.setTimeout(() => {
      setModeMenuOpen(false);
      modeCloseTimerRef.current = null;
    }, 180);
  };

  const openAdminMenu = () => {
    if (adminCloseTimerRef.current !== null) {
      window.clearTimeout(adminCloseTimerRef.current);
      adminCloseTimerRef.current = null;
    }
    setAdminMenuOpen(true);
  };

  const closeAdminMenuSoon = () => {
    if (adminCloseTimerRef.current !== null) {
      window.clearTimeout(adminCloseTimerRef.current);
    }
    adminCloseTimerRef.current = window.setTimeout(() => {
      setAdminMenuOpen(false);
      adminCloseTimerRef.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (modeCloseTimerRef.current !== null) {
        window.clearTimeout(modeCloseTimerRef.current);
      }
      if (adminCloseTimerRef.current !== null) {
        window.clearTimeout(adminCloseTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        {topbarTitle}
        <nav className="app-topbar-nav" aria-label="Primary navigation">
          <div
            className="app-topbar-menu"
            onPointerEnter={openModeMenu}
            onPointerLeave={closeModeMenuSoon}
            onBlur={(e) => {
              const nextFocus = e.relatedTarget;
              if (!(nextFocus instanceof Node) || !e.currentTarget.contains(nextFocus)) {
                closeModeMenuSoon();
              }
            }}
          >
            <button
              type="button"
              className={`app-topbar-link ${isMode ? 'active' : ''}`}
              onClick={() => setModeMenuOpen((v) => !v)}
              onFocus={openModeMenu}
              aria-haspopup="menu"
              aria-expanded={modeMenuOpen}
            >
              <Activity size={16} />
              <span>{activeModeLabel}</span>
              <ChevronDown size={14} className={`app-topbar-chevron ${modeMenuOpen ? 'open' : ''}`} />
            </button>
            {modeMenuOpen && (
              <div
                className="app-topbar-dropdown"
                role="menu"
                aria-label="Workspace modes"
                onPointerEnter={openModeMenu}
                onPointerLeave={closeModeMenuSoon}
              >
                <button
                  type="button"
                  className={`app-topbar-dropdown-item ${isHome ? 'active' : ''}`}
                  onClick={() => navigateAndClose('/')}
                  role="menuitem"
                >
                  <User size={14} />
                  <span>Personal</span>
                </button>
                <button
                  type="button"
                  className={`app-topbar-dropdown-item ${isTeam ? 'active' : ''}`}
                  onClick={() => navigateAndClose('/team')}
                  role="menuitem"
                >
                  <Users size={14} />
                  <span>Team</span>
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`app-topbar-link ${isHistory ? 'active' : ''}`}
            onClick={() => navigateAndClose('/history')}
          >
            <History size={16} />
            <span>Lịch sử</span>
          </button>
          {user.isAdmin && (
            <div
              className="app-topbar-menu"
              onPointerEnter={openAdminMenu}
              onPointerLeave={closeAdminMenuSoon}
              onBlur={(e) => {
                const nextFocus = e.relatedTarget;
                if (!(nextFocus instanceof Node) || !e.currentTarget.contains(nextFocus)) {
                  closeAdminMenuSoon();
                }
              }}
            >
              <button
                type="button"
                className={`app-topbar-link ${isAdmin ? 'active' : ''}`}
                onClick={() => setAdminMenuOpen((v) => !v)}
                onFocus={openAdminMenu}
                aria-haspopup="menu"
                aria-expanded={adminMenuOpen}
              >
                <ShieldCheck size={16} />
                <span>Admin</span>
                <ChevronDown size={14} className={`app-topbar-chevron ${adminMenuOpen ? 'open' : ''}`} />
              </button>
              {adminMenuOpen && (
                <div
                  className="app-topbar-dropdown"
                  role="menu"
                  aria-label="Admin sections"
                  onPointerEnter={openAdminMenu}
                  onPointerLeave={closeAdminMenuSoon}
                >
                  <button
                    type="button"
                    className={`app-topbar-dropdown-item ${isAdminUsers ? 'active' : ''}`}
                    onClick={() => navigateAndClose('/admin/users')}
                    role="menuitem"
                  >
                    <Users size={14} />
                    <span>Users</span>
                  </button>
                  <button
                    type="button"
                    className={`app-topbar-dropdown-item ${isAdminAudit ? 'active' : ''}`}
                    onClick={() => navigateAndClose('/admin/audit')}
                    role="menuitem"
                  >
                    <ClipboardList size={14} />
                    <span>Audit</span>
                  </button>
                  <button
                    type="button"
                    className={`app-topbar-dropdown-item ${isAdminSettings ? 'active' : ''}`}
                    onClick={() => navigateAndClose('/admin/settings')}
                    role="menuitem"
                  >
                    <SettingsIcon size={14} />
                    <span>Settings</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </nav>
        {topbarContent && (
          <div className="app-topbar-extra">
            {topbarContent}
          </div>
        )}
      </header>
      <main className="app-main">
        {children}
      </main>
    </div>
  );
};

interface SettingsPopoverProps {
  apiKey: string;
  onSaveKey: (key: string) => void;
  isKeyValid: 'valid' | 'invalid' | 'unchecked' | 'checking';
  keyError: string;
  onCheckKey: (keyToCheck?: string, modelToCheck?: string) => Promise<boolean>;
  ttsStatus: 'ready' | 'error' | 'checking' | 'unconfigured';
  onCheckTTS: () => Promise<void> | void;
  model: string;
  inputStyle: InputStyle;
  setInputStyle: (s: InputStyle) => void;
  pttKey: string;
  setPttKey: (k: string) => void;
  showLeaveRoom?: boolean;
  onLeaveRoom?: () => void;
  onLogout: () => void;
  onClose: () => void;
}

const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  apiKey,
  onSaveKey,
  isKeyValid,
  keyError,
  onCheckKey,
  onCheckTTS,
  model,
  inputStyle,
  setInputStyle,
  pttKey,
  setPttKey,
  showLeaveRoom,
  onLeaveRoom,
  onLogout,
  onClose,
}) => {
  const [capturing, setCapturing] = useState(false);
  const [localKey, setLocalKey] = useState(apiKey);
  const [testing, setTesting] = useState(false);

  // Sync local state when parent loads config from server asynchronously.
  useEffect(() => {
    setLocalKey(apiKey);
  }, [apiKey]);

  // Auto-save the API key (debounced) — no manual save button.
  useEffect(() => {
    if (localKey === apiKey) return;
    const t = setTimeout(() => onSaveKey(localKey), 600);
    return () => clearTimeout(t);
  }, [localKey, apiKey, onSaveKey]);

  const handleTest = async () => {
    setTesting(true);
    onSaveKey(localKey); // Persist immediately before testing
    try {
      await Promise.all([onCheckKey(localKey, model), onCheckTTS()]);
    } finally {
      setTesting(false);
    }
  };

  const testIcon = testing ? (
    <RefreshCw size={16} className="animate-spin" />
  ) : isKeyValid === 'valid' ? (
    <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />
  ) : isKeyValid === 'invalid' ? (
    <AlertTriangle size={16} style={{ color: 'var(--color-error)' }} />
  ) : (
    <Activity size={16} />
  );

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.settings-popover') && !target.closest('.topbar-icon-btn')) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);

  // Capture the next keypress when user clicks the keybinding input
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      // Prevent the PTT listener in RecordingStation from firing on the very same key event
      e.stopImmediatePropagation();
      if (e.code === 'Escape') {
        setCapturing(false);
        return;
      }
      setPttKey(e.code);
      setCapturing(false);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      // Also swallow the matching keyup so RecordingStation doesn't try to stop a non-existent session
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    return () => {
      window.removeEventListener('keydown', onKey, { capture: true } as any);
      window.removeEventListener('keyup', onKeyUp, { capture: true } as any);
    };
  }, [capturing, setPttKey]);

  const pttOn = inputStyle === 'ptt';

  return (
    <div className="settings-popover panel-card">
      <div className="settings-popover-header">
        <h3>Cài đặt</h3>
        <button className="topbar-icon-btn" onClick={onClose} title="Đóng">
          <X size={14} />
        </button>
      </div>

      <div className="settings-group">
        <label className="settings-label">Google AI Studio API Key</label>
        {!localKey.trim() && (
          <a
            className="settings-api-help"
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Click vào đây để lấy API key
          </a>
        )}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="password"
            className="input-control"
            placeholder="AIzaSy..."
            value={localKey}
            onChange={(e) => setLocalKey(e.target.value)}
          />
          <button
            className="topbar-icon-btn settings-test-btn"
            onClick={handleTest}
            disabled={testing}
            title="Kiểm tra kết nối"
          >
            {testIcon}
          </button>
        </div>
        {isKeyValid === 'invalid' && keyError && (
          <div
            className="font-mono"
            style={{
              fontSize: '0.72rem',
              color: 'var(--color-error)',
              lineHeight: 1.4,
              overflowWrap: 'anywhere',
              background: '#2a1118',
              padding: '0.5rem 0.75rem',
              borderRadius: '0.5rem',
              border: '1px solid rgba(239, 68, 68, 0.2)',
            }}
          >
            {keyError}
          </div>
        )}
      </div>

      <div className="settings-divider"></div>

      <div className="settings-group">
        <div className="toggle-row">
          <p style={{ fontWeight: 500, fontSize: '0.85rem' }}>Push-to-Talk</p>
          <label className="switch">
            <input
              type="checkbox"
              checked={pttOn}
              onChange={(e) => setInputStyle(e.target.checked ? 'ptt' : 'toggle')}
            />
            <span className="slider"></span>
          </label>
        </div>

        {pttOn && (
          <div className="settings-keybind-row">
            <label className="settings-label">Phím</label>
            <button
              type="button"
              className={`settings-keybind ${capturing ? 'capturing' : ''}`}
              onClick={() => setCapturing(true)}
              title="Click rồi bấm phím muốn dùng"
            >
              {capturing ? (
                <span className="settings-keybind-prompt font-mono">Bấm phím...</span>
              ) : (
                <kbd>{displayKey(pttKey)}</kbd>
              )}
            </button>
          </div>
        )}
      </div>

      <div className="settings-divider"></div>

      {showLeaveRoom && (
        <>
          <button type="button" className="btn btn-secondary settings-wide-btn" onClick={onLeaveRoom}>
            <LogOut size={14} />
            Rời phòng
          </button>
          <div className="settings-divider"></div>
        </>
      )}

      <button className="logout-btn settings-logout" onClick={onLogout}>
        <LogOut size={14} />
        Đăng xuất
      </button>
    </div>
  );
};

function displayKey(code: string): string {
  if (code === 'Space') return 'Space';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5) + ' ↑';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Shift';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
}

export default App;
