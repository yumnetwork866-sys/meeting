import { useState, useEffect, useCallback } from 'react';

export interface TranscriptItem {
  id: string;
  timestamp: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  speakerId?: string;
  speakerName?: string;
  isSelf?: boolean;
}

interface UseTranslatorProps {
  onShowToast: (message: string) => void;
  token: string | null;
  /** Called when a translation produces a new transcript (owned by useSessions). */
  onTranscript: (
    originalText: string,
    translatedText: string,
    sourceLang: string,
    targetLang: string
  ) => void;
}

const DEFAULT_MODEL = (import.meta as any).env?.VITE_DEFAULT_MODEL || 'gemini-3.6-flash';

// --- Gemini key-check cache (localStorage) -------------------------------
// Tránh đốt quota Gemini mỗi lần F5: nhớ kết quả check theo (key, model).
const CHECK_CACHE_KEY = 'gemini_check_cache';
const VALID_TTL_MS = 12 * 60 * 60 * 1000; // key hợp lệ: tin trong 12h
const INVALID_TTL_MS = 10 * 60 * 1000; // key lỗi: chỉ tin 10 phút (để sửa xong check lại sớm)

interface CheckCache {
  fp: string;
  model: string;
  status: 'valid' | 'invalid';
  message: string;
  checkedAt: number;
}

// Hash nhẹ, KHÔNG lưu key thô vào localStorage.
function keyFingerprint(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return `${key.length}:${h}`;
}

function readCheckCache(): CheckCache | null {
  try {
    return JSON.parse(localStorage.getItem(CHECK_CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeCheckCache(c: CheckCache) {
  try {
    localStorage.setItem(CHECK_CACHE_KEY, JSON.stringify(c));
  } catch {
    /* ignore quota/serialization errors */
  }
}

function isCacheFresh(c: CheckCache): boolean {
  const ttl = c.status === 'valid' ? VALID_TTL_MS : INVALID_TTL_MS;
  return Date.now() - c.checkedAt < ttl;
}

export const useTranslator = ({ onShowToast, token, onTranscript }: UseTranslatorProps) => {
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [isKeyValid, setIsKeyValid] = useState<'valid' | 'invalid' | 'unchecked' | 'checking'>('unchecked');
  const [keyError, setKeyError] = useState<string>('');
  const [ttsStatus, setTtsStatus] = useState<'ready' | 'error' | 'checking' | 'unconfigured'>('unconfigured');
  const [isTranslating, setIsTranslating] = useState(false);

  // Load API key + model from server when user logs in
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setApiKey('');
        setModel(DEFAULT_MODEL);
        setIsKeyValid('unchecked');
        setKeyError('');
        return;
      }
      try {
        const res = await fetch('/api/user/config', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          console.warn('Load user config failed:', res.status, await res.text().catch(() => ''));
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        const loadedKey = (data.apiKey || '').trim();
        const loadedModel = (data.model && data.model.trim()) || DEFAULT_MODEL;
        setApiKey(loadedKey);
        setModel(loadedModel);
        setKeyError('');

        // Auto-check khi load trang (= mỗi lần F5).
        void checkEdgeTTS(); // TTS free → check thoải mái.
        if (!loadedKey) {
          setIsKeyValid('unchecked');
          return;
        }
        const cache = readCheckCache();
        const fp = keyFingerprint(loadedKey);
        if (cache && cache.fp === fp && cache.model === loadedModel && isCacheFresh(cache)) {
          // Còn tươi → dùng lại, không gọi Gemini (không đốt quota).
          setIsKeyValid(cache.status);
          setKeyError(cache.status === 'invalid' ? cache.message : '');
        } else {
          // Chưa có cache / key|model đổi / hết hạn → check 1 lần (sẽ tự ghi cache).
          setIsKeyValid('unchecked');
          void checkApiKey(loadedKey, loadedModel);
        }
      } catch (err) {
        console.warn('Failed to load user config:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // checkApiKey/checkEdgeTTS cố tình không đưa vào deps để tránh re-run mỗi render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const pushConfig = useCallback(
    async (patch: { apiKey?: string; model?: string }) => {
      if (!token) return;
      try {
        await fetch('/api/user/config', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(patch),
        });
      } catch (err) {
        console.warn('Failed to save user config:', err);
        onShowToast('⚠️ Không lưu được cấu hình lên server.');
      }
    },
    [token, onShowToast]
  );

  const saveApiKey = (key: string) => {
    const cleanKey = key.trim();
    setApiKey(cleanKey);
    setIsKeyValid('unchecked');
    void pushConfig({ apiKey: cleanKey });
  };

  const saveModel = (selectedModel: string) => {
    const cleanModel = selectedModel.trim();
    setModel(cleanModel);
    void pushConfig({ model: cleanModel });
  };

  const checkApiKey = useCallback(async (keyToCheck?: string, modelToCheck?: string) => {
    const key = keyToCheck !== undefined ? keyToCheck : apiKey;
    const selectedModel = (modelToCheck !== undefined ? modelToCheck : model).trim();
    if (!key) {
      setKeyError('Chưa nhập API Key.');
      setIsKeyValid('invalid');
      return false;
    }

    setKeyError('');
    setIsKeyValid('checking');
    try {
      const response = await fetch(`/api/test-key?model=${encodeURIComponent(selectedModel)}`, {
        method: 'GET',
        headers: {
          'x-gemini-api-key': key,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.ok) {
        setKeyError('');
        setIsKeyValid('valid');
        writeCheckCache({ fp: keyFingerprint(key), model: selectedModel, status: 'valid', message: '', checkedAt: Date.now() });
        return true;
      }

      const msg = data.message || data.error || `Key validation failed (HTTP ${response.status}).`;
      setKeyError(msg);
      setIsKeyValid('invalid');
      writeCheckCache({ fp: keyFingerprint(key), model: selectedModel, status: 'invalid', message: msg, checkedAt: Date.now() });
      return false;
    } catch (err: any) {
      console.error('API key check failed:', err);
      setKeyError(err?.message || 'Không kết nối được tới server.');
      setIsKeyValid('invalid');
      return false;
    }
  }, [apiKey, model]);

  const checkEdgeTTS = useCallback(async () => {
    setTtsStatus('checking');
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'Status check', language: 'en-US' }),
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && !data.error && data.audioBase64) {
        setTtsStatus('ready');
      } else {
        setTtsStatus('error');
      }
    } catch (err) {
      console.error('Edge TTS check failed:', err);
      setTtsStatus('error');
    }
  }, []);

  const translateAudio = async (
    audioBase64: string,
    mimeType: string,
    sourceLang: string,
    targetLang: string
  ) => {
    if (!apiKey) {
      onShowToast('⚠️ Vui lòng cấu hình Gemini API Key trước khi thực hiện dịch.');
      setIsKeyValid('invalid');
      return;
    }

    setIsTranslating(true);
    try {
      const response = await fetch('/api/translate-audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': apiKey,
        },
        body: JSON.stringify({
          audioBase64,
          mimeType,
          sourceLang,
          targetLang,
          model,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Dịch thuật thất bại.');
      }

      const data = await response.json();

      onTranscript(data.originalText, data.translatedText, sourceLang, targetLang);
    } catch (err: any) {
      console.error('Translation process error:', err);
      onShowToast(`❌ Lỗi: ${err.message || 'Không kết nối được tới server'}`);
    } finally {
      setIsTranslating(false);
    }
  };

  const translateText = async (
    text: string,
    sourceLang: string,
    targetLang: string
  ): Promise<string> => {
    if (!apiKey) {
      onShowToast('⚠️ Vui lòng cấu hình Gemini API Key trước khi thực hiện dịch.');
      setIsKeyValid('invalid');
      throw new Error('API Key missing');
    }

    try {
      const response = await fetch('/api/translate-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': apiKey,
        },
        body: JSON.stringify({
          text,
          sourceLang,
          targetLang,
          model,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Dịch thuật thất bại.');
      }

      const data = await response.json();
      return data.translatedText;
    } catch (err: any) {
      console.error('Translation process error:', err);
      onShowToast(`❌ Lỗi: ${err.message || 'Không kết nối được tới server'}`);
      throw err;
    }
  };

  return {
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
  };
};
