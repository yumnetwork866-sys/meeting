import { useState, useEffect, useRef } from 'react';

interface UseRealtimeTranslatorProps {
  sourceLang: string;
  targetLang: string;
  translateText: (text: string, sourceLang: string, targetLang: string) => Promise<string>;
  addTranscriptItem: (originalText: string, translatedText: string, sourceLang: string, targetLang: string) => void;
  onShowToast: (message: string) => void;
}

export const useRealtimeTranslator = ({
  sourceLang,
  targetLang,
  translateText,
  addTranscriptItem,
  onShowToast,
}: UseRealtimeTranslatorProps) => {
  const [realtimeMode, setRealtimeMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState('');
  const [isTranslatingRealtime, setIsTranslatingRealtime] = useState(false);

  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(isListening);

  // Sync ref to avoid closure issues in callbacks
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const isSupported = typeof window !== 'undefined' && 
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const startListening = () => {
    if (!isSupported) {
      onShowToast('❌ Trình duyệt của bạn không hỗ trợ Speech Recognition. Hãy dùng Chrome hoặc Edge.');
      return;
    }

    try {
      const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognitionClass();
      recognitionRef.current = recognition;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = sourceLang;

      recognition.onstart = () => {
        setIsListening(true);
        setInterimText('');
      };

      recognition.onresult = async (event: any) => {
        let currentInterim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const result = event.results[i];
          const transcript = result[0].transcript.trim();

          if (result.isFinal) {
            if (transcript) {
              setIsTranslatingRealtime(true);
              try {
                const translated = await translateText(transcript, sourceLang, targetLang);
                addTranscriptItem(transcript, translated, sourceLang, targetLang);
              } catch (e) {
                console.error('Real-time final translation failed:', e);
              } finally {
                setIsTranslatingRealtime(false);
              }
              setInterimText('');
            }
          } else {
            currentInterim += (currentInterim ? ' ' : '') + transcript;
          }
        }
        setInterimText(currentInterim);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'not-allowed') {
          onShowToast('❌ Vui lòng cho phép quyền truy cập micro.');
          stopListening();
        }
      };

      recognition.onend = () => {
        if (isListeningRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            console.error('Failed to restart speech recognition:', e);
          }
        } else {
          setIsListening(false);
        }
      };

      recognition.start();
    } catch (e: any) {
      console.error('Speech recognition failed to start:', e);
      onShowToast(`❌ Lỗi khởi động nhận diện giọng nói: ${e.message}`);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    setIsListening(false);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error(e);
      }
      recognitionRef.current = null;
    }
    setInterimText('');
  };

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  return {
    realtimeMode,
    setRealtimeMode,
    isListening,
    startListening,
    stopListening,
    interimText,
    isTranslatingRealtime,
    isSupported,
  };
};
