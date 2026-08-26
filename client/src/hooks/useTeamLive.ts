import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranscriptItem } from './useTranslator';

type AnyObj = Record<string, any>;

export interface TeamParticipant {
  id: string;
  username: string;
  language: string;
  isSpeaker: boolean;
}

interface UseTeamLiveProps {
  token: string | null;
  voiceEnabled: boolean;
  onShowToast: (message: string) => void;
}

interface RoomConfig {
  sourceLang: string;
  targetLang: string;
  model: string;
}

const PLAYBACK_RATE = 24000;
const DEFAULT_MODEL = 'gemini-3.5-live-translate-preview';

function mergeLiveText(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;

  // Google Live can emit the full accumulated transcription repeatedly.
  // Treat those as snapshots so we don't duplicate text in the buffer.
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;

  return current + incoming;
}

const pick = (obj: AnyObj | undefined, ...keys: string[]): any => {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
};

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}

function int16ToFloat32(int16: Int16Array): Float32Array {
  const f = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    const v = int16[i];
    f[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return f;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function makeTranscript(
  originalText: string,
  translatedText: string,
  sourceLang: string,
  targetLang: string,
  meta?: { speakerId?: string; speakerName?: string; isSelf?: boolean }
): TranscriptItem {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    originalText,
    translatedText,
    sourceLang,
    targetLang,
    speakerId: meta?.speakerId,
    speakerName: meta?.speakerName,
    isSelf: meta?.isSelf,
  };
}

function toServerTranscriptItem(item: AnyObj, clientId?: string): TranscriptItem {
  return {
    id: String(item.id || crypto.randomUUID()),
    timestamp: new Date(item.createdAt || Date.now()).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
    originalText: String(item.originalText || ''),
    translatedText: String(item.translatedText || ''),
    sourceLang: String(item.sourceLang || ''),
    targetLang: String(item.targetLang || ''),
    speakerId: item.speakerId || undefined,
    speakerName: item.speakerName || undefined,
    isSelf: !!item.speakerId && !!clientId && item.speakerId === clientId,
  };
}

export const useTeamLive = ({ token, voiceEnabled, onShowToast }: UseTeamLiveProps) => {
  const [roomId, setRoomId] = useState('');
  const [clientId, setClientId] = useState('');
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<TeamParticipant[]>([]);
  const [roomConfig, setRoomConfig] = useState<RoomConfig>({
    sourceLang: 'en-US',
    targetLang: 'vi-VN',
    model: DEFAULT_MODEL,
  });
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [activeSpeakerName, setActiveSpeakerName] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [interimSource, setInterimSource] = useState('');
  const [interimTarget, setInterimTarget] = useState('');
  const [currentSourceLang, setCurrentSourceLang] = useState('');
  const [currentTargetLang, setCurrentTargetLang] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playCtxRef = useRef<AudioContext | null>(null);
  const playGainRef = useRef<GainNode | null>(null);
  const playHeadRef = useRef(0);
  const readyResolverRef = useRef<(() => void) | null>(null);
  const readyRejecterRef = useRef<((err: Error) => void) | null>(null);
  const joinResolverRef = useRef<(() => void) | null>(null);
  const joinRejecterRef = useRef<((err: Error) => void) | null>(null);
  const joinCompletedRef = useRef(false);
  const connectAttemptRef = useRef(0);
  const manualCloseRef = useRef(false);
  const voiceEnabledRef = useRef(voiceEnabled);
  const turnSourceRef = useRef('');
  const turnTargetRef = useRef('');
  const turnSourceLangRef = useRef('');
  const turnTargetLangRef = useRef('');
  const latestRoomConfigRef = useRef(roomConfig);
  const clientIdRef = useRef('');
  const activeSpeakerIdRef = useRef<string | null>(null);
  const activeSpeakerNameRef = useRef('');
  const listenerLanguageRef = useRef('');

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (playGainRef.current) playGainRef.current.gain.value = voiceEnabled ? 1 : 0;
  }, [voiceEnabled]);

  useEffect(() => {
    latestRoomConfigRef.current = roomConfig;
  }, [roomConfig]);

  useEffect(() => {
    listenerLanguageRef.current = participants.find((p) => p.id === clientId)?.language || '';
  }, [participants, clientId]);

  const cleanupCapture = useCallback(() => {
    if (workletRef.current) {
      try {
        workletRef.current.port.onmessage = null;
        workletRef.current.disconnect();
      } catch {}
      workletRef.current = null;
    }
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try {
        audioCtxRef.current.close();
      } catch {}
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsSpeaking(false);
    setIsStarting(false);
    setIsStopping(false);
  }, []);

  const cleanupPlayback = useCallback(() => {
    if (playCtxRef.current && playCtxRef.current.state !== 'closed') {
      try {
        playCtxRef.current.close();
      } catch {}
    }
    playCtxRef.current = null;
    playGainRef.current = null;
    playHeadRef.current = 0;
  }, []);

  const flushTurn = useCallback(() => {
    const original = turnSourceRef.current.trim();
    const translated = turnTargetRef.current.trim();
    const sourceLang = turnSourceLangRef.current || latestRoomConfigRef.current.sourceLang;
    const targetLang = turnTargetLangRef.current || latestRoomConfigRef.current.targetLang;
    const speakerId = activeSpeakerIdRef.current || undefined;
    const speakerName = activeSpeakerNameRef.current || '';
    turnSourceRef.current = '';
    turnTargetRef.current = '';
    turnSourceLangRef.current = '';
    turnTargetLangRef.current = '';
    setInterimSource('');
    setInterimTarget('');
    setCurrentSourceLang('');
    setCurrentTargetLang('');
    if (!original && !translated) return;

    setTranscripts((prev) => [
      ...prev,
      makeTranscript(original, translated, sourceLang, targetLang, {
        speakerId,
        speakerName: speakerName || undefined,
        isSelf: !!speakerId && speakerId === clientIdRef.current,
      }),
    ]);
  }, []);

  const resetRoomState = useCallback(() => {
    joinCompletedRef.current = false;
    setRoomId('');
    setClientId('');
    setConnected(false);
    setParticipants([]);
    setActiveSpeakerId(null);
    setActiveSpeakerName('');
    setInterimSource('');
    setInterimTarget('');
    setCurrentSourceLang('');
    setCurrentTargetLang('');
    turnSourceRef.current = '';
    turnTargetRef.current = '';
    turnSourceLangRef.current = '';
    turnTargetLangRef.current = '';
    activeSpeakerIdRef.current = null;
    activeSpeakerNameRef.current = '';
    setIsStopping(false);
  }, []);

  const disconnect = useCallback(() => {
    connectAttemptRef.current += 1;
    joinCompletedRef.current = false;
    joinResolverRef.current = null;
    joinRejecterRef.current = null;
    manualCloseRef.current = true;
    cleanupCapture();
    cleanupPlayback();
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    resetRoomState();
  }, [cleanupCapture, cleanupPlayback, resetRoomState]);

  useEffect(() => disconnect, [disconnect]);

  const playPcmChunk = useCallback((int16: Int16Array) => {
    if (!voiceEnabledRef.current || int16.length === 0) return;
    if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: PLAYBACK_RATE });
      playCtxRef.current = ctx;
      playHeadRef.current = ctx.currentTime;
    }
    const ctx = playCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!playGainRef.current) {
      const gain = ctx.createGain();
      gain.gain.value = voiceEnabledRef.current ? 1 : 0;
      gain.connect(ctx.destination);
      playGainRef.current = gain;
    }
    const float = int16ToFloat32(int16) as Float32Array<ArrayBuffer>;
    const buffer = ctx.createBuffer(1, float.length, PLAYBACK_RATE);
    buffer.copyToChannel(float, 0, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(playGainRef.current);
    const startAt = Math.max(ctx.currentTime, playHeadRef.current);
    src.start(startAt);
    playHeadRef.current = startAt + buffer.duration;
  }, []);

  const handleLiveMessage = useCallback((raw: string, allowAudio = true) => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    const content: AnyObj | undefined = pick(msg, 'serverContent', 'server_content');
    if (!content) return;

    const inputTr = pick(
      content,
      'inputTranscription',
      'input_transcription',
      'inputAudioTranscription',
      'input_audio_transcription'
    );
    if (inputTr?.text) {
      turnSourceRef.current = mergeLiveText(turnSourceRef.current, String(inputTr.text));
      setInterimSource(turnSourceRef.current);
    }

    const outputTr = pick(
      content,
      'outputTranscription',
      'output_transcription',
      'outputAudioTranscription',
      'output_audio_transcription'
    );
    if (outputTr?.text) {
      turnTargetRef.current = mergeLiveText(turnTargetRef.current, String(outputTr.text));
      setInterimTarget(turnTargetRef.current);
    }

    const modelTurn = pick(content, 'modelTurn', 'model_turn');
    const parts: AnyObj[] = modelTurn?.parts || [];
    for (const part of parts) {
      const inline = pick(part, 'inlineData', 'inline_data');
      const data = inline?.data;
      const mime: string = pick(inline, 'mimeType', 'mime_type') || '';
      if (allowAudio && data && mime.startsWith('audio/')) {
        try {
          playPcmChunk(base64ToInt16(data));
        } catch (err) {
          console.warn('[team-live] audio decode failed:', err);
        }
      }
    }

    const turnComplete = pick(content, 'turnComplete', 'turn_complete');
    if (turnComplete) flushTurn();
  }, [flushTurn, playPcmChunk]);

  const shouldPlayAudioForListener = useCallback((targetLang?: string) => {
    const listenerLang = listenerLanguageRef.current;
    if (!voiceEnabledRef.current) return false;
    if (!listenerLang || !targetLang) return false;
    return listenerLang === targetLang;
  }, []);

  const handleMessage = useCallback((raw: string) => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'connected') {
      setClientId(msg.clientId || '');
      clientIdRef.current = msg.clientId || '';
      joinCompletedRef.current = true;
      joinResolverRef.current?.();
      joinResolverRef.current = null;
      joinRejecterRef.current = null;
      return;
    }

    if (msg.type === 'room_state') {
      setConnected(true);
      setRoomId(msg.roomId || '');
      const roomParticipants = Array.isArray(msg.participants) ? msg.participants : [];
      setParticipants(roomParticipants);
      setRoomConfig({
        sourceLang: msg.sourceLang || 'en-US',
        targetLang: msg.targetLang || 'vi-VN',
        model: msg.model || DEFAULT_MODEL,
      });
      setActiveSpeakerId(msg.activeSpeakerId || null);
      activeSpeakerIdRef.current = msg.activeSpeakerId || null;
      const speaker = roomParticipants.find((p: TeamParticipant) => p.id === msg.activeSpeakerId);
      activeSpeakerNameRef.current = speaker?.username || '';
      setActiveSpeakerName(speaker?.username || '');
      listenerLanguageRef.current = roomParticipants.find((p: TeamParticipant) => p.id === clientIdRef.current)?.language || '';
      return;
    }

    if (msg.type === 'room_history') {
      const items = Array.isArray(msg.transcripts) ? msg.transcripts : [];
      setTranscripts(items.map((item: AnyObj) => toServerTranscriptItem(item, clientIdRef.current)));
      return;
    }

    if (msg.type === 'speaker_started') {
      setIsStopping(false);
      turnSourceRef.current = '';
      turnTargetRef.current = '';
      turnSourceLangRef.current = msg.sourceLang || latestRoomConfigRef.current.sourceLang;
      turnTargetLangRef.current = msg.targetLang || latestRoomConfigRef.current.targetLang;
      setInterimSource('');
      setInterimTarget('');
      setCurrentSourceLang(turnSourceLangRef.current);
      setCurrentTargetLang(turnTargetLangRef.current);
      setActiveSpeakerId(msg.speakerId || null);
      setActiveSpeakerName(msg.speakerName || '');
      activeSpeakerIdRef.current = msg.speakerId || null;
      activeSpeakerNameRef.current = msg.speakerName || '';
      return;
    }

    if (msg.type === 'speaker_stopping') {
      setIsStopping(true);
      return;
    }

    if (msg.type === 'live_ready') {
      readyResolverRef.current?.();
      readyResolverRef.current = null;
      readyRejecterRef.current = null;
      return;
    }

    if (msg.type === 'live_message') {
      if (msg.speakerName) {
        activeSpeakerNameRef.current = msg.speakerName;
        setActiveSpeakerName(msg.speakerName);
      }
      if (msg.sourceLang) {
        turnSourceLangRef.current = msg.sourceLang;
        setCurrentSourceLang(msg.sourceLang);
      }
      if (msg.targetLang) {
        turnTargetLangRef.current = msg.targetLang;
        setCurrentTargetLang(msg.targetLang);
      }
      if (typeof msg.data === 'string') {
        handleLiveMessage(msg.data, shouldPlayAudioForListener(msg.targetLang || turnTargetLangRef.current));
      }
      return;
    }

    if (msg.type === 'speaker_stopped') {
      readyRejecterRef.current?.(new Error(msg.reason || 'Luồng dịch Team đã dừng trước khi sẵn sàng'));
      readyResolverRef.current = null;
      readyRejecterRef.current = null;
      flushTurn();
      cleanupCapture();
      setActiveSpeakerId(null);
      setActiveSpeakerName('');
      activeSpeakerIdRef.current = null;
      activeSpeakerNameRef.current = '';
      setIsStopping(false);
      return;
    }

    if (msg.type === 'error') {
      onShowToast(`Team: ${msg.error || 'lỗi'}`);
      if (!joinCompletedRef.current) {
        joinRejecterRef.current?.(new Error(msg.error || 'Lỗi phòng Team'));
        joinResolverRef.current = null;
        joinRejecterRef.current = null;
      }
      readyRejecterRef.current?.(new Error(msg.error || 'Lỗi phòng Team'));
      readyResolverRef.current = null;
      readyRejecterRef.current = null;
      cleanupCapture();
      setIsStopping(false);
    }
  }, [cleanupCapture, flushTurn, handleLiveMessage, onShowToast, shouldPlayAudioForListener]);

  const connect = useCallback(async (initialMessage: AnyObj) => {
    if (!token) {
      onShowToast('Cần đăng nhập trước.');
      return;
    }

    disconnect();
    manualCloseRef.current = false;
    joinCompletedRef.current = false;
    const attempt = connectAttemptRef.current + 1;
    connectAttemptRef.current = attempt;
    const url = new URL('/ws/team-live', window.location.origin.replace(/^http/, 'ws'));
    url.searchParams.set('token', token);

    const ws = new WebSocket(url.toString());
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      if (connectAttemptRef.current !== attempt) return;
      if (typeof ev.data === 'string') handleMessage(ev.data);
      else if (ev.data instanceof ArrayBuffer) handleMessage(new TextDecoder('utf-8').decode(ev.data));
      else if (typeof Blob !== 'undefined' && ev.data instanceof Blob) ev.data.text().then(handleMessage).catch(() => {});
    };
    ws.onerror = () => {
      if (connectAttemptRef.current !== attempt) return;
      onShowToast('Mất kết nối Team.');
    };
    ws.onclose = () => {
      if (connectAttemptRef.current !== attempt) return;
      cleanupCapture();
      cleanupPlayback();
      if (!manualCloseRef.current) {
        resetRoomState();
        onShowToast('Đã rời khỏi phòng Team.');
      }
    };

    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => {
        if (joinCompletedRef.current) return;
        reject(new Error('Kết nối phòng quá thời gian chờ'));
      }, 8000);
      joinResolverRef.current = () => {
        if (connectAttemptRef.current !== attempt) return;
        window.clearTimeout(t);
        resolve();
      };
      joinRejecterRef.current = (err) => {
        if (connectAttemptRef.current !== attempt) return;
        window.clearTimeout(t);
        reject(err);
      };
      ws.onopen = () => {
        if (connectAttemptRef.current !== attempt) return;
        ws.send(JSON.stringify(initialMessage));
      };
      ws.addEventListener('close', () => {
        if (connectAttemptRef.current !== attempt) return;
        window.clearTimeout(t);
        if (joinCompletedRef.current) return;
        reject(new Error('Kết nối phòng bị đóng trước khi vào phòng'));
      }, { once: true });
    });
  }, [cleanupCapture, cleanupPlayback, disconnect, handleMessage, onShowToast, resetRoomState, token]);

  const createRoom = useCallback((config: RoomConfig) => {
    setTranscripts([]);
    return connect({ type: 'create_room', ...config });
  }, [connect]);

  const joinRoom = useCallback((joinId: string) => {
    setTranscripts([]);
    return connect({ type: 'join_room', roomId: joinId.trim().toUpperCase() });
  }, [connect]);

  const setParticipantLanguage = useCallback((language: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      onShowToast('Hãy tạo hoặc tham gia phòng trước.');
      return;
    }
    ws.send(JSON.stringify({ type: 'set_language', language }));
  }, [onShowToast]);

  const startCapture = useCallback(async (audioSource: 'mic' | 'tab') => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('Phòng Team chưa được kết nối');

    let stream: MediaStream;
    if (audioSource === 'tab') {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const audioTracks = display.getAudioTracks();
      if (audioTracks.length === 0) {
        display.getTracks().forEach((track) => track.stop());
        throw new Error('Không có âm thanh được chia sẻ. Hãy bật chia sẻ âm thanh của tab.');
      }
      display.getVideoTracks().forEach((track) => track.stop());
      stream = new MediaStream(audioTracks);
      audioTracks[0].addEventListener('ended', () => {
        ws.send(JSON.stringify({ type: 'speaker_stop' }));
        cleanupCapture();
      });
    } else {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    streamRef.current = stream;

    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    await ctx.audioWorklet.addModule('/pcm-recorder-processor.js');
    const source = ctx.createMediaStreamSource(stream);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyserRef.current = analyser;

    const worklet = new AudioWorkletNode(ctx, 'pcm-recorder-processor', {
      processorOptions: { targetSampleRate: 16000 },
    });
    source.connect(worklet);
    worklet.port.onmessage = (ev) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({
        type: 'audio',
        data: arrayBufferToBase64(ev.data),
        mimeType: 'audio/pcm;rate=16000',
      }));
    };
    workletRef.current = worklet;
    setIsSpeaking(true);
    setIsStopping(false);
  }, [cleanupCapture]);

  const startSpeaking = useCallback(async (audioSource: 'mic' | 'tab' = 'mic') => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      onShowToast('Hãy tạo hoặc tham gia phòng trước.');
      return;
    }
    if (activeSpeakerId && activeSpeakerId !== clientId) {
      onShowToast('Một người khác đang nói.');
      return;
    }
    if (isSpeaking || isStarting || isStopping) return;

    setIsStarting(true);
    try {
      const ready = new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error('Bắt đầu dịch trực tiếp quá thời gian chờ')), 10000);
        readyResolverRef.current = () => {
          window.clearTimeout(t);
          resolve();
        };
        readyRejecterRef.current = (err) => {
          window.clearTimeout(t);
          reject(err);
        };
      });
      ws.send(JSON.stringify({ type: 'speaker_start' }));
      await ready;
      await startCapture(audioSource);
    } catch (err: any) {
      onShowToast(`Không bắt đầu nói được: ${err?.message || 'lỗi không xác định'}`);
      try {
        ws.send(JSON.stringify({ type: 'speaker_stop' }));
      } catch {}
      cleanupCapture();
    } finally {
      setIsStarting(false);
    }
  }, [activeSpeakerId, cleanupCapture, clientId, isSpeaking, isStarting, isStopping, onShowToast, startCapture]);

  const stopSpeaking = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'speaker_stop' }));
    setIsStopping(true);
    cleanupCapture();
  }, [cleanupCapture]);

  const deleteTranscript = useCallback((id: string) => {
    setTranscripts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  return {
    roomId,
    clientId,
    connected,
    participants,
    roomConfig,
    myLanguage: participants.find((p) => p.id === clientId)?.language || '',
    currentSourceLang: currentSourceLang || roomConfig.sourceLang,
    currentTargetLang: currentTargetLang || roomConfig.targetLang,
    activeSpeakerId,
    activeSpeakerName,
    isStarting,
    isSpeaking,
    isStopping,
    isSomeoneSpeaking: !!activeSpeakerId,
    interimSource,
    interimTarget,
    transcripts,
    analyser: analyserRef.current,
    createRoom,
    joinRoom,
    setParticipantLanguage,
    disconnect,
    startSpeaking,
    stopSpeaking,
    deleteTranscript,
  };
};
