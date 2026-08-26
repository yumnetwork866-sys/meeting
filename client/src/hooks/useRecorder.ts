import { useState, useRef, useEffect } from 'react';

interface UseRecorderProps {
  onAudioReady: (base64Audio: string, mimeType: string, transcribedText?: string) => void;
  onError: (message: string) => void;
}

export const useRecorder = ({ onAudioReady, onError }: UseRecorderProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const [cabinMode, setCabinMode] = useState(false);
  const [cabinInterval, setCabinInterval] = useState(15); // Default 15s

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cabinTimerRef = useRef<any>(null);
  const isTransitioningRef = useRef(false); // To prevent concurrent overlap

  const recognitionRef = useRef<any>(null);
  const transcribedTextRef = useRef<string>('');
  const isRecordingRef = useRef(false);
  const activeLangRef = useRef<string>('vi-VN');

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopAllMedia();
    };
  }, []);

  const stopAllMedia = () => {
    if (cabinTimerRef.current) {
      clearInterval(cabinTimerRef.current);
      cabinTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch (e) {}
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.error(e);
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  };

  const startRecording = async (lang: string = 'vi-VN') => {
    try {
      stopAllMedia();
      chunksRef.current = [];
      transcribedTextRef.current = '';
      activeLangRef.current = lang;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up Audio Analyser for waves (always run this so visualizer waves move on screen)
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      
      if (SpeechRecognitionClass) {
        // Use browser SpeechRecognition ONLY - avoids conflicts and OpenRouter $0.50 audio limit
        const rec = new SpeechRecognitionClass();
        rec.continuous = true;
        rec.interimResults = true; // Use true for better responsiveness and tracking
        rec.lang = lang;

        rec.onresult = (event: any) => {
          let resultText = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              resultText += event.results[i][0].transcript;
            }
          }
          if (resultText) {
            transcribedTextRef.current += (transcribedTextRef.current ? ' ' : '') + resultText.trim();
          }
        };

        rec.onerror = (e: any) => {
          console.warn('Background SpeechRecognition error:', e.error);
          if (e.error !== 'no-speech') {
            onError(`Lỗi nhận dạng giọng nói: ${e.error}`);
          }
        };

        recognitionRef.current = rec;
        try {
          rec.start();
        } catch (err) {
          console.error('Failed to start background SpeechRecognition:', err);
        }
        setIsRecording(true);
      } else {
        // Fallback to MediaRecorder for browsers that don't support SpeechRecognition
        let mimeType = 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
          mimeType = 'audio/webm;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
          mimeType = 'audio/ogg;codecs=opus';
        } else if (MediaRecorder.isTypeSupported('audio/wav')) {
          mimeType = 'audio/wav';
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
          mimeType = 'audio/mp4';
        }

        const mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(chunksRef.current, { type: mimeType });
          if (audioBlob.size > 0) {
            const base64 = await blobToBase64(audioBlob);
            onAudioReady(base64, mimeType);
          }
        };

        mediaRecorder.start();
        setIsRecording(true);
      }

      // Cabin mode interval handler
      if (cabinMode) {
        isTransitioningRef.current = false;
        cabinTimerRef.current = setInterval(() => {
          stopRecording(); // Trigger stop (and restart will handle inside stopRecording if cabinMode is still true)
        }, cabinInterval * 1000);
      }

    } catch (err: any) {
      console.error('Recording initialization failed:', err);
      onError(err.message || 'Cannot access microphone. Please check permissions.');
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    isTransitioningRef.current = true;
    const isUsingSpeech = !!recognitionRef.current;

    if (isUsingSpeech) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch (e) {}

      // Wait briefly for final text processing (600ms is perfect)
      setTimeout(() => {
        onAudioReady("", "", transcribedTextRef.current);
        
        // Handle Cabin Mode continuation
        if (cabinMode && !isTransitioningRef.current) {
          startRecording(activeLangRef.current);
        }
      }, 600);
    } else {
      // Fallback: stop MediaRecorder (triggers onstop)
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try {
          mediaRecorderRef.current.stop();
        } catch (e) {
          console.error(e);
        }
      }
    }

    // Stop streams
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;

    if (cabinTimerRef.current) {
      clearInterval(cabinTimerRef.current);
      cabinTimerRef.current = null;
    }

    setIsRecording(false);
  };

  // Helper: Read Blob as Base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Split metadata header out (e.g. data:audio/webm;base64,...)
        const base64Data = base64String.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Handle uploaded files
  const processUploadedFile = async (file: File) => {
    try {
      const mimeType = file.type || 'audio/mp3';
      const base64 = await blobToBase64(file);
      onAudioReady(base64, mimeType);
    } catch (err: any) {
      onError('Failed to process uploaded file: ' + err.message);
    }
  };

  // Keep interval logic synced if cabinMode changes live
  useEffect(() => {
    if (isRecording && !cabinMode) {
      // Switched off cabinMode mid-recording
      if (cabinTimerRef.current) {
        clearInterval(cabinTimerRef.current);
        cabinTimerRef.current = null;
      }
    } else if (isRecording && cabinMode && !cabinTimerRef.current) {
      // Switched on cabinMode mid-recording
      isTransitioningRef.current = false;
      cabinTimerRef.current = setInterval(() => {
        stopRecording();
      }, cabinInterval * 1000);
    }
  }, [cabinMode, cabinInterval, isRecording]);

  return {
    isRecording,
    startRecording,
    stopRecording,
    cabinMode,
    setCabinMode,
    cabinInterval,
    setCabinInterval,
    processUploadedFile,
    analyser: analyserRef.current
  };
};
