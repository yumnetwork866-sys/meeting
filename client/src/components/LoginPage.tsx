import React, { useState } from 'react';
import { Sparkles, LogIn, UserPlus, Loader2, KeyRound } from 'lucide-react';

type Mode = 'login' | 'register' | 'forgot';

interface LoginPageProps {
  onLogin: (username: string, password: string) => Promise<unknown>;
  onRegister: (username: string, password: string) => Promise<unknown>;
  onReset: (username: string, password: string) => Promise<void>;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin, onRegister, onReset }) => {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!username.trim() || !password) {
      setError('Vui lòng nhập đầy đủ username và password.');
      return;
    }
    if (mode === 'register' || mode === 'forgot') {
      if (password.length < 6) {
        setError('Password tối thiểu 6 ký tự.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Xác nhận password không khớp.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await onLogin(username.trim(), password);
      } else if (mode === 'register') {
        await onRegister(username.trim(), password);
        setInfo('Đã tạo tài khoản. Vui lòng chờ admin duyệt trước khi đăng nhập.');
        setPassword('');
        setConfirmPassword('');
        setMode('login');
      } else {
        await onReset(username.trim(), password);
        setInfo('Đã đổi mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.');
        setPassword('');
        setConfirmPassword('');
        setMode('login');
      }
    } catch (err: any) {
      setError(err?.message || 'Có lỗi xảy ra.');
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setInfo('');
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <div className="login-shell">
      <div className="login-card panel-card">
        <div className="login-brand">
          <Sparkles size={32} className="logo-icon" />
          <h1 className="app-title" style={{ fontSize: '1.5rem' }}>SpeakLink</h1>
        </div>

        <div className="login-tabs">
          <button
            type="button"
            className={`login-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => switchMode('login')}
          >
            <LogIn size={14} /> Đăng nhập
          </button>
          <button
            type="button"
            className={`login-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => switchMode('register')}
          >
            <UserPlus size={14} /> Đăng ký
          </button>
        </div>

        <form onSubmit={submit} className="login-form">
          <div className="input-group">
            <label className="input-label">Username</label>
            <input
              type="text"
              className="input-control"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="input-group">
            <label className="input-label">{mode === 'forgot' ? 'Mật khẩu mới' : 'Password'}</label>
            <input
              type="password"
              className="input-control"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
            />
          </div>

          {(mode === 'register' || mode === 'forgot') && (
            <div className="input-group">
              <label className="input-label">Xác nhận mật khẩu</label>
              <input
                type="password"
                className="input-control"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={submitting}
              />
            </div>
          )}

          {error && (
            <div
              className="font-mono"
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-error)',
                background: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem',
              }}
            >
              {error}
            </div>
          )}

          {info && (
            <div
              className="font-mono"
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-success, #22c55e)',
                background: 'rgba(34, 197, 94, 0.08)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem',
              }}
            >
              {info}
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? (
              <Loader2 size={16} className="animate-spin" />
            ) : mode === 'login' ? (
              <LogIn size={16} />
            ) : mode === 'register' ? (
              <UserPlus size={16} />
            ) : (
              <KeyRound size={16} />
            )}
            {mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Đặt lại mật khẩu'}
          </button>
        </form>

        {mode === 'login' && (
          <p className="login-hint font-mono" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="login-link" onClick={() => switchMode('forgot')}>
              Quên mật khẩu?
            </button>
          </p>
        )}

        <p className="login-hint font-mono">
          {mode === 'forgot' ? (
            <>
              Nhớ lại mật khẩu?{' '}
              <button type="button" className="login-link" onClick={() => switchMode('login')}>
                Đăng nhập
              </button>
            </>
          ) : (
            <>
              {mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}{' '}
              <button
                type="button"
                className="login-link"
                onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? 'Đăng ký ngay' : 'Đăng nhập'}
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
};
