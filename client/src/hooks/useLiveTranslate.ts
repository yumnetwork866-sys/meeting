import { useCallback, useEffect, useRef, useState } from 'react';

interface UseLiveTranslateProps {
  token: string | null;
  sourceLang: string;
  targetLang: string;
  model: string;
  voiceEnabled?: boolean;
  onTurnComplete: (originalText: string, translatedText: string, sourceLang: string, targetLang: string) => void;
  onShowToast: (message: string) => void;
}

// Live API responses may arrive in either camelCase or snake_case; we pick whichever is present.
type AnyObj = Record<string, any>;
const pick = (obj: AnyObj | undefined, ...keys: string[]): any => {
  if (!obj) return undefined;
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
};

const PLAYBACK_RATE = 24000;
const INPUT_SAMPLE_RATE = 16000;
const FINAL_SILENCE_FRAME_MS = 200;
const FINAL_SILENCE_FRAME_COUNT = 5;
// When a shared tab finishes, Google may need a moment of silence to close its
// final turn and return the transcription. Keep the socket alive for that turn.
const FINAL_TURN_TIMEOUT_MS = 5000;

function mergeLiveText(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;

  // Google Live responses may resend the full accumulated text on each update.
  // Treat those messages as snapshots instead of blindly appending them.
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  if (current.endsWith(incoming)) return current;

  return current + incoming;
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
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

export const useLiveTranslate = ({
  token,
  sourceLang,
  targetLang,
  model,
  voiceEnabled = true,
  onTurnComplete,
  onShowToast,
}: UseLiveTranslateProps) => {
  const [isLive, setIsLive] = useState(false);
  const [interimSource, setInterimSource] = useState('');
  const [interimTarget, setInterimTarget] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Playback queue
  const playCtxRef = useRef<AudioContext | null>(null);
  const playHeadRef = useRef<number>(0);
  const playGainRef = useRef<GainNode | null>(null);
  const voiceEnabledRef = useRef<boolean>(voiceEnabled);
  const drainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDrainingRef = useRef(false);

  // Toggle spoken translation on/off live by muting the playback gain node.
  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    if (playGainRef.current) {
      playGainRef.current.gain.value = voiceEnabled ? 1 : 0;
    }
  }, [voiceEnabled]);

  // Turn accumulators (mutable across renders, flushed on turnComplete)
  const turnSourceRef = useRef('');
  const turnTargetRef = useRef('');
  const turnLangsRef = useRef({ source: sourceLang, target: targetLang });

  useEffect(() => {
    turnLangsRef.current = { source: sourceLang, target: targetLang };
  }, [sourceLang, targetLang]);

  const stopCapture = useCallback(() => {
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
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    isDrainingRef.current = false;
    if (drainTimerRef.current !== null) {
      clearTimeout(drainTimerRef.current);
      drainTimerRef.current = null;
    }

    stopCapture();

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    if (playCtxRef.current && playCtxRef.current.state !== 'closed') {
      try {
        playCtxRef.current.close();
      } catch {}
    }
    playCtxRef.current = null;
    playGainRef.current = null;
    playHeadRef.current = 0;

    setIsLive(false);
  }, [stopCapture]);

  useEffect(() => cleanup, [cleanup]);

  // Save whatever has accumulated in the current (not-yet-completed) turn.
  const flushTurn = useCallback(() => {
    const original = turnSourceRef.current.trim();
    const translated = turnTargetRef.current.trim();
    turnSourceRef.current = '';
    turnTargetRef.current = '';
    setInterimSource('');
    setInterimTarget('');
    if (original || translated) {
      const { source, target } = turnLangsRef.current;
      onTurnComplete(original, translated, source, target);
    }
  }, [onTurnComplete]);

  // Tab audio ending is not equivalent to the Live API turn being complete.
  // Stop sending audio, then wait for its final transcription/translation.
  const drainFinalTabTurn = useCallback(() => {
    if (isDrainingRef.current) return;

    // Mark this before stopping tracks: stopping the stream can synchronously
    // dispatch another `ended` event for its remaining tracks.
    isDrainingRef.current = true;
    stopCapture();

    // An ended MediaStream stops packets abruptly; it does not send the silence
    // required for server-side VAD to close the final spoken turn. Append one
    // second of PCM silence explicitly before waiting for turnComplete.
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      const samplesPerFrame = (INPUT_SAMPLE_RATE * FINAL_SILENCE_FRAME_MS) / 1000;
      const silence = arrayBufferToBase64(new ArrayBuffer(samplesPerFrame * Int16Array.BYTES_PER_ELEMENT));
      try {
        for (let i = 0; i < FINAL_SILENCE_FRAME_COUNT; i += 1) {
          ws.send(JSON.stringify({
            realtimeInput: {
              audio: { data: silence, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
            },
          }));
        }
      } catch (err) {
        console.warn('[live] could not send final silence:', err);
      }
    }
    drainTimerRef.current = setTimeout(() => {
      drainTimerRef.current = null;
      flushTurn();
      cleanup();
    }, FINAL_TURN_TIMEOUT_MS);
  }, [cleanup, flushTurn, stopCapture]);

  const playPcmChunk = useCallback((int16: Int16Array) => {
    if (int16.length === 0) return;
    if (!playCtxRef.current || playCtxRef.current.state === 'closed') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx({ sampleRate: PLAYBACK_RATE });
      playCtxRef.current = ctx;
      playGainRef.current = null;
      playHeadRef.current = ctx.currentTime;
    }
    const ctx = playCtxRef.current;
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

  const handleServerMessage = useCallback((raw: string) => {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Custom proxy-level messages
    if (msg.type === 'ready') return;
    if (msg.type === 'error') {
      onShowToast(`❌ Live: ${msg.error || 'lỗi'}`);
      cleanup();
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
      if (data && mime.startsWith('audio/')) {
        try {
          playPcmChunk(base64ToInt16(data));
        } catch (err) {
          console.warn('[live] audio decode failed:', err);
        }
      }
    }

    const turnComplete = pick(content, 'turnComplete', 'turn_complete');
    if (turnComplete) {
      flushTurn();
      if (isDrainingRef.current) {
        if (drainTimerRef.current !== null) clearTimeout(drainTimerRef.current);
        drainTimerRef.current = null;
        cleanup();
      }
    }
  }, [cleanup, flushTurn, onShowToast, playPcmChunk]);

  const startLive = useCallback(async (audioSource: 'mic' | 'tab' = 'mic') => {
    if (!token) {
      onShowToast('⚠️ Cần đăng nhập trước.');
      return;
    }
    if (isLive) return;

    try {
      // 1) Open WS first so we don't waste mic on a doomed session
      const url = new URL('/ws/live-translate', window.location.origin.replace(/^http/, 'ws'));
      url.searchParams.set('token', token);
      url.searchParams.set('source', sourceLang);
      url.searchParams.set('target', targetLang);
      url.searchParams.set('model', model);

      const ws = new WebSocket(url.toString());
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        const d = ev.data;
        if (typeof d === 'string') {
          handleServerMessage(d);
        } else if (d instanceof ArrayBuffer) {
          handleServerMessage(new TextDecoder('utf-8').decode(d));
        } else if (typeof Blob !== 'undefined' && d instanceof Blob) {
          d.text().then(handleServerMessage).catch(() => {});
        }
      };
      ws.onerror = () => {
        onShowToast('❌ Mất kết nối Live API.');
      };
      ws.onclose = () => {
        if (wsRef.current === ws) cleanup();
      };

      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('WS open timeout')), 8000);
        ws.onopen = () => {
          clearTimeout(t);
          resolve();
        };
        ws.addEventListener('close', () => {
          clearTimeout(t);
          reject(new Error('WS closed before open'));
        }, { once: true });
      });

      // 2) Capture audio (browser tab/system audio or microphone) + worklet
      let stream: MediaStream;
      if (audioSource === 'tab') {
        // Browsers only expose tab/system audio through getDisplayMedia, and most
        // require a video track to be requested alongside it. We grab the audio,
        // then drop the video track since Live API only needs the sound.
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        const audioTracks = display.getAudioTracks();
        if (audioTracks.length === 0) {
          display.getTracks().forEach((t) => t.stop());
          throw new Error('Không có âm thanh được chia sẻ. Hãy bật "Chia sẻ âm thanh" (Share tab audio) khi chọn tab/cửa sổ.');
        }
        display.getVideoTracks().forEach((t) => t.stop());
        stream = new MediaStream(audioTracks);
        // A tab ending must be drained: the final transcription normally arrives
        // shortly after the track's `ended` event.
        audioTracks[0].addEventListener('ended', drainFinalTabTurn, { once: true });
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
      // worklet doesn't need to be connected to destination; we read postMessage only

      worklet.port.onmessage = (ev) => {
        const buf: ArrayBuffer = ev.data;
        if (!buf || !(ws.readyState === WebSocket.OPEN)) return;
        const b64 = arrayBufferToBase64(buf);
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: { data: b64, mimeType: 'audio/pcm;rate=16000' },
          },
        }));
      };
      workletRef.current = worklet;

      setIsLive(true);
    } catch (err: any) {
      console.error('[live] start failed:', err);
      onShowToast(`❌ Không khởi động được Live: ${err?.message || 'lỗi không xác định'}`);
      cleanup();
    }
  }, [token, sourceLang, targetLang, model, isLive, handleServerMessage, cleanup, drainFinalTabTurn, onShowToast]);

  const stopLive = useCallback(() => {
    flushTurn();
    cleanup();
  }, [flushTurn, cleanup]);

  return {
    isLive,
    startLive,
    stopLive,
    interimSource,
    interimTarget,
    analyser: analyserRef.current,
  };
};
