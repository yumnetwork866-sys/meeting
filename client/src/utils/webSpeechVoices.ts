export const webSpeechVoices: Record<string, string> = {
  'vi-VN': 'vi-VN',
  'ms-MY': 'ms-MY',
  'en-US': 'en-US',
  'en-GB': 'en-GB',
  'zh-CN': 'zh-CN',
  'ja-JP': 'ja-JP',
  'ko-KR': 'ko-KR',
  'fr-FR': 'fr-FR',
  'de-DE': 'de-DE'
};

/**
 * Finds a matching browser voice for Web Speech Synthesis.
 * Falls back to matching prefixes if the exact language tag is not present in the user's OS.
 */
export const getBrowserVoice = (
  langCode: string,
  voices: SpeechSynthesisVoice[]
): SpeechSynthesisVoice | null => {
  const targetLang = webSpeechVoices[langCode] || langCode;
  
  // 1. Try exact match (e.g., 'vi-VN' or 'en-US')
  let voice = voices.find(
    (v) =>
      v.lang === targetLang ||
      v.lang.replace('_', '-').toLowerCase() === targetLang.toLowerCase()
  );
  
  // 2. Try prefix match (e.g., 'en' for 'en-US')
  if (!voice) {
    const langPrefix = targetLang.split('-')[0].toLowerCase();
    voice = voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
  }
  
  return voice || null;
};
