import { useState } from 'react';
import { getBrowserVoice } from '../utils/webSpeechVoices';

interface UseEdgeTTSProps {
  onShowToast: (message: string) => void;
}

export const useEdgeTTS = ({ onShowToast }: UseEdgeTTSProps) => {
  const [loadingCardId, setLoadingCardId] = useState<string | null>(null);
  const [playingCardId, setPlayingCardId] = useState<string | null>(null);

  const speakOriginal = async (text: string, language: string, cardId: string) => {
    const playKey = `${cardId}-original`;
    setPlayingCardId(playKey);

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;

      // Select matching browser system voice
      const voices = window.speechSynthesis.getVoices();
      const voice = getBrowserVoice(language, voices);
      if (voice) {
        utterance.voice = voice;
      }

      await new Promise<void>((resolve) => {
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    } catch (err) {
      console.error('Browser Speech Synthesis failed:', err);
    } finally {
      setPlayingCardId(null);
    }
  };

  const speakAI = async (text: string, language: string, cardId: string) => {
    const playKey = `${cardId}-ai`;
    setLoadingCardId(playKey);
    setPlayingCardId(playKey);

    try {
      // 1. Call Local Edge TTS Backend
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text, language }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'TTS service error');
      }

      const { audioBase64, error, mimeType } = await response.json();
      if (error || !audioBase64) {
        throw new Error(error || 'TTS service returned no audio');
      }
      // Keep loading indicator until playback finishes (handled later)

      // Play the Base64 response
      await playBase64(audioBase64, mimeType);
      // Playback finished – clear loading state
      setLoadingCardId(null);
    } catch (err: any) {
      console.warn('Edge TTS failed, falling back to Web Speech API. Error:', err.message);
      onShowToast('⚠️ Lỗi Edge TTS Local. Tự động chuyển qua giọng hệ thống.');
      setLoadingCardId(null);

      // Fallback: system speech synthesis
      await speakOriginal(text, language, cardId);
    } finally {
      setLoadingCardId(null);
      setPlayingCardId(null);
    }
  };

  const playBase64 = (base64: string, mimeType: string): Promise<void> => {
    return new Promise((resolve, reject) => {
        try {
          const binaryString = window.atob(base64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const blob = new Blob([bytes], { type: mimeType });
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          // Ensure audio is ready before playing to avoid race conditions
          audio.addEventListener('canplaythrough', () => {
            audio.play().then(() => {
              // Resolve when playback ends
              audio.addEventListener('ended', () => {
                URL.revokeObjectURL(url);
                resolve();
              });
            }).catch((err) => {
              URL.revokeObjectURL(url);
              reject(err);
            });
          });
          audio.addEventListener('error', (e) => {
            URL.revokeObjectURL(url);
            reject(e);
          });
        } catch (e) {
          reject(e);
        }
      });
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setPlayingCardId(null);
  };

  return {
    loadingCardId,
    playingCardId,
    speakOriginal,
    speakAI,
    stopSpeaking,
  };
};
