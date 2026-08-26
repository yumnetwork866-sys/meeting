import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptItem } from './useTranslator';
import { downloadExport, type ExportFormat } from '../utils/exportTranscripts';

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  count: number;
}

interface ServerTranscript {
  id: string;
  sessionId: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
}

interface UseSessionsProps {
  token: string | null;
  userId: string | null;
  onShowToast: (message: string) => void;
}

const legacyKey = (userId: string | null) =>
  userId ? `translator_transcripts_${userId}` : 'translator_transcripts_guest';

const activeSessionKey = (userId: string | null) =>
  userId ? `translator_active_session_${userId}` : 'translator_active_session_guest';

const pad = (n: number) => String(n).padStart(2, '0');

function defaultSessionTitle(): string {
  const d = new Date();
  return `Phiên ${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isDefaultSessionTitle(title: string): boolean {
  return title === 'Phiên mới' || /^Phiên \d{2}\/\d{2} \d{2}:\d{2}$/.test(title);
}

function titleFromTranscript(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const chars = Array.from(normalized);
  if (chars.length <= 40) return normalized;
  return `${chars.slice(0, 40).join('')}...`;
}

function timeFromISO(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

function toItem(t: ServerTranscript): TranscriptItem {
  return {
    id: t.id,
    timestamp: timeFromISO(t.createdAt),
    originalText: t.originalText,
    translatedText: t.translatedText,
    sourceLang: t.sourceLang,
    targetLang: t.targetLang,
  };
}

export const useSessions = ({ token, userId, onShowToast }: UseSessionsProps) => {
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [loading, setLoading] = useState(false);

  const activeIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeIdRef.current = activeId;
    // Remember the open session so a page refresh restores it.
    if (userId && activeId) localStorage.setItem(activeSessionKey(userId), activeId);
  }, [activeId, userId]);

  // Holds an in-flight auto-create so rapid transcripts don't spawn many sessions
  const creatingRef = useRef<Promise<string> | null>(null);
  const pendingAutoTitleRef = useRef<Set<string>>(new Set());

  const authHeaders = useCallback(
    (json = false): Record<string, string> => {
      const h: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (json) h['Content-Type'] = 'application/json';
      return h;
    },
    [token]
  );

  // ---- Raw API helpers ----
  const apiListSessions = useCallback(async (): Promise<SessionMeta[]> => {
    const res = await fetch('/api/sessions', { headers: authHeaders() });
    if (!res.ok) throw new Error('list sessions failed');
    const data = await res.json();
    return data.sessions || [];
  }, [authHeaders]);

  const apiCreateSession = useCallback(
    async (title: string): Promise<SessionMeta> => {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('create session failed');
      const data = await res.json();
      return data.session as SessionMeta;
    },
    [authHeaders]
  );

  const apiListTranscripts = useCallback(
    async (sessionId: string): Promise<TranscriptItem[]> => {
      const res = await fetch(`/api/sessions/${sessionId}/transcripts`, { headers: authHeaders() });
      if (!res.ok) throw new Error('list transcripts failed');
      const data = await res.json();
      return (data.transcripts || []).map(toItem);
    },
    [authHeaders]
  );

  const apiAddTranscript = useCallback(
    async (sessionId: string, body: Omit<ServerTranscript, 'id' | 'sessionId' | 'createdAt'>) => {
      const res = await fetch(`/api/sessions/${sessionId}/transcripts`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('add transcript failed');
      const data = await res.json();
      return data.transcript as ServerTranscript;
    },
    [authHeaders]
  );

  const apiRenameSession = useCallback(
    async (id: string, title: string) => {
      const res = await fetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error('rename failed');
    },
    [authHeaders]
  );

  // ---- Initial load (+ one-time localStorage migration) ----
  useEffect(() => {
    if (!token || !userId) {
      setSessions([]);
      setActiveId(null);
      setTranscripts([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let list = await apiListSessions();

        // Migrate legacy localStorage transcripts into a session, once.
        if (list.length === 0) {
          try {
            const raw = localStorage.getItem(legacyKey(userId));
            const legacy: TranscriptItem[] = raw ? JSON.parse(raw) : [];
            if (legacy.length > 0) {
              const migrated = await apiCreateSession('Lịch sử đã nhập');
              // Insert oldest-first so newest keeps the latest timestamp
              for (const item of [...legacy].reverse()) {
                await apiAddTranscript(migrated.id, {
                  originalText: item.originalText,
                  translatedText: item.translatedText,
                  sourceLang: item.sourceLang,
                  targetLang: item.targetLang,
                  userId,
                } as any);
              }
              localStorage.removeItem(legacyKey(userId));
              list = await apiListSessions();
            }
          } catch (err) {
            console.warn('Legacy transcript migration skipped:', err);
          }
        }

        if (cancelled) return;
        setSessions(list);

        if (list.length > 0) {
          const stored = localStorage.getItem(activeSessionKey(userId));
          const chosen = (stored && list.find((s) => s.id === stored)) || list[0];
          setActiveId(chosen.id);
          const items = await apiListTranscripts(chosen.id);
          if (!cancelled) setTranscripts(items);
        } else {
          setActiveId(null);
          setTranscripts([]);
        }
      } catch (err) {
        console.warn('Failed to load sessions:', err);
        if (!cancelled) onShowToast('⚠️ Không tải được lịch sử phiên từ server.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, userId]);

  // Move a session to the top and refresh its meta (count delta / updatedAt)
  const bumpSession = useCallback((id: string, countDelta: number) => {
    setSessions((prev) => {
      const found = prev.find((s) => s.id === id);
      if (!found) return prev;
      const updated: SessionMeta = {
        ...found,
        count: Math.max(0, found.count + countDelta),
        updatedAt: new Date().toISOString(),
      };
      return [updated, ...prev.filter((s) => s.id !== id)];
    });
  }, []);

  // Ensure there is an active session, auto-creating one if needed.
  const ensureSession = useCallback(async (): Promise<string> => {
    if (activeIdRef.current) return activeIdRef.current;
    if (creatingRef.current) return creatingRef.current;
    const p = (async () => {
      const s = await apiCreateSession(defaultSessionTitle());
      pendingAutoTitleRef.current.add(s.id);
      setSessions((prev) => [{ ...s, count: 0 }, ...prev]);
      setActiveId(s.id);
      activeIdRef.current = s.id;
      setTranscripts([]);
      return s.id;
    })();
    creatingRef.current = p;
    try {
      return await p;
    } finally {
      creatingRef.current = null;
    }
  }, [apiCreateSession]);

  // ---- Public actions ----
  const createSession = useCallback(async () => {
    try {
      const s = await apiCreateSession(defaultSessionTitle());
      pendingAutoTitleRef.current.add(s.id);
      setSessions((prev) => [{ ...s, count: 0 }, ...prev]);
      setActiveId(s.id);
      activeIdRef.current = s.id;
      setTranscripts([]);
    } catch {
      onShowToast('❌ Không tạo được phiên mới.');
    }
  }, [apiCreateSession, onShowToast]);

  const ensureActiveSession = useCallback(async () => {
    try {
      return await ensureSession();
    } catch {
      onShowToast('❌ Không tạo được phiên mới.');
      return null;
    }
  }, [ensureSession, onShowToast]);

  const selectSession = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      setActiveId(id);
      activeIdRef.current = id;
      setLoading(true);
      try {
        const items = await apiListTranscripts(id);
        setTranscripts(items);
      } catch {
        onShowToast('❌ Không tải được nội dung phiên.');
        setTranscripts([]);
      } finally {
        setLoading(false);
      }
    },
    [apiListTranscripts, onShowToast]
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      const clean = title.trim();
      if (!clean) return;
      pendingAutoTitleRef.current.delete(id);
      const prevSessions = sessions;
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: clean } : s)));
      try {
        const res = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          body: JSON.stringify({ title: clean }),
        });
        if (!res.ok) throw new Error('rename failed');
      } catch {
        setSessions(prevSessions);
        onShowToast('❌ Không đổi được tên phiên.');
      }
    },
    [sessions, authHeaders, onShowToast]
  );

  const deleteSession = useCallback(
    async (id: string) => {
      const prevSessions = sessions;
      const remaining = sessions.filter((s) => s.id !== id);
      setSessions(remaining);

      if (activeIdRef.current === id) {
        const next = remaining[0] || null;
        setActiveId(next ? next.id : null);
        activeIdRef.current = next ? next.id : null;
        if (next) {
          try {
            setTranscripts(await apiListTranscripts(next.id));
          } catch {
            setTranscripts([]);
          }
        } else {
          setTranscripts([]);
        }
      }

      try {
        const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE', headers: authHeaders() });
        if (!res.ok) throw new Error('delete failed');
      } catch {
        setSessions(prevSessions);
        onShowToast('❌ Không xoá được phiên.');
      }
    },
    [sessions, apiListTranscripts, authHeaders, onShowToast]
  );

  const addTranscriptItem = useCallback(
    async (originalText: string, translatedText: string, sourceLang: string, targetLang: string) => {
      let sessionId: string;
      try {
        sessionId = await ensureSession();
      } catch {
        onShowToast('❌ Không tạo được phiên để lưu đoạn dịch.');
        return;
      }

      const session = sessions.find((s) => s.id === sessionId);
      const oldTitle = session?.title;
      const autoTitle =
        session && session.count === 0 && oldTitle && isDefaultSessionTitle(oldTitle)
          ? titleFromTranscript(originalText)
          : null;
      if (autoTitle) {
        setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: autoTitle } : s)));
        try {
          await apiRenameSession(sessionId, autoTitle);
        } catch {
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title: oldTitle! } : s)));
        }
      }

      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const optimistic: TranscriptItem = {
        id: tempId,
        timestamp: timeFromISO(new Date().toISOString()),
        originalText,
        translatedText,
        sourceLang,
        targetLang,
      };
      if (sessionId === activeIdRef.current) {
        setTranscripts((prev) => [optimistic, ...prev]);
      }

      try {
        const saved = await apiAddTranscript(sessionId, {
          originalText,
          translatedText,
          sourceLang,
          targetLang,
          userId: userId || '',
        } as any);
        if (sessionId === activeIdRef.current) {
          setTranscripts((prev) => prev.map((t) => (t.id === tempId ? toItem(saved) : t)));
        }
        bumpSession(sessionId, 1);
      } catch {
        if (sessionId === activeIdRef.current) {
          setTranscripts((prev) => prev.filter((t) => t.id !== tempId));
        }
        onShowToast('❌ Không lưu được đoạn dịch lên server.');
      }
    },
    [ensureSession, sessions, apiRenameSession, apiAddTranscript, bumpSession, onShowToast, userId]
  );

  const deleteTranscript = useCallback(
    async (id: string) => {
      const sessionId = activeIdRef.current;
      setTranscripts((prev) => prev.filter((t) => t.id !== id));
      if (sessionId) bumpSession(sessionId, -1);
      if (id.startsWith('temp_') || !sessionId) return;
      try {
        await fetch(`/api/sessions/${sessionId}/transcripts/${id}`, {
          method: 'DELETE',
          headers: authHeaders(),
        });
      } catch {
        onShowToast('⚠️ Không xoá được đoạn dịch trên server.');
      }
    },
    [authHeaders, bumpSession, onShowToast]
  );

  const exportSession = useCallback(
    async (id: string, format: ExportFormat) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) return;
      try {
        const items =
          id === activeIdRef.current ? transcripts : await apiListTranscripts(id);
        if (items.length === 0) {
          onShowToast('⚠️ Phiên này chưa có nội dung để xuất.');
          return;
        }
        downloadExport(session.title, items, format);
      } catch {
        onShowToast('❌ Không xuất được nội dung phiên.');
      }
    },
    [sessions, transcripts, apiListTranscripts, onShowToast]
  );

  const clearActiveSession = useCallback(async () => {
    const sessionId = activeIdRef.current;
    if (!sessionId) return;
    setTranscripts([]);
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, count: 0 } : s)));
    try {
      await fetch(`/api/sessions/${sessionId}/transcripts`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
    } catch {
      onShowToast('⚠️ Không xoá được nội dung phiên trên server.');
    }
  }, [authHeaders, onShowToast]);

  return {
    sessions,
    activeId,
    transcripts,
    loading,
    ensureActiveSession,
    createSession,
    selectSession,
    renameSession,
    deleteSession,
    addTranscriptItem,
    deleteTranscript,
    clearActiveSession,
    exportSession,
  };
};
