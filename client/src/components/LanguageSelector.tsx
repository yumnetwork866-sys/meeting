import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Globe, ChevronDown, Search, Check } from 'lucide-react';

interface LanguageSelectorProps {
  sourceLang: string;
  setSourceLang: (lang: string) => void;
  targetLang: string;
  setTargetLang: (lang: string) => void;
  compact?: boolean;
}

export const languages = [
  { code: 'vi-VN', country: 'vn', name: 'Vietnamese' },
  { code: 'en-US', country: 'us', name: 'English (US)' },
  { code: 'en-GB', country: 'gb', name: 'English (UK)' },
  { code: 'en-AU', country: 'au', name: 'English (Australia)' },
  { code: 'ar-SA', country: 'sa', name: 'Arabic' },
  { code: 'bn-BD', country: 'bd', name: 'Bengali' },
  { code: 'zh-CN', country: 'cn', name: 'Chinese (Simplified)' },
  { code: 'zh-TW', country: 'tw', name: 'Chinese (Traditional)' },
  { code: 'cs-CZ', country: 'cz', name: 'Czech' },
  { code: 'nl-NL', country: 'nl', name: 'Dutch' },
  { code: 'fil-PH', country: 'ph', name: 'Filipino' },
  { code: 'fi-FI', country: 'fi', name: 'Finnish' },
  { code: 'fr-FR', country: 'fr', name: 'French' },
  { code: 'fr-CA', country: 'ca', name: 'French (Canada)' },
  { code: 'de-DE', country: 'de', name: 'German' },
  { code: 'el-GR', country: 'gr', name: 'Greek' },
  { code: 'he-IL', country: 'il', name: 'Hebrew' },
  { code: 'hi-IN', country: 'in', name: 'Hindi' },
  { code: 'hu-HU', country: 'hu', name: 'Hungarian' },
  { code: 'id-ID', country: 'id', name: 'Indonesian' },
  { code: 'it-IT', country: 'it', name: 'Italian' },
  { code: 'ja-JP', country: 'jp', name: 'Japanese' },
  { code: 'ko-KR', country: 'kr', name: 'Korean' },
  { code: 'ms-MY', country: 'my', name: 'Malay' },
  { code: 'nb-NO', country: 'no', name: 'Norwegian' },
  { code: 'pl-PL', country: 'pl', name: 'Polish' },
  { code: 'pt-BR', country: 'br', name: 'Portuguese (Brazil)' },
  { code: 'pt-PT', country: 'pt', name: 'Portuguese (Portugal)' },
  { code: 'ro-RO', country: 'ro', name: 'Romanian' },
  { code: 'ru-RU', country: 'ru', name: 'Russian' },
  { code: 'es-ES', country: 'es', name: 'Spanish (Spain)' },
  { code: 'es-MX', country: 'mx', name: 'Spanish (Mexico)' },
  { code: 'sv-SE', country: 'se', name: 'Swedish' },
  { code: 'ta-IN', country: 'in', name: 'Tamil' },
  { code: 'th-TH', country: 'th', name: 'Thai' },
  { code: 'tr-TR', country: 'tr', name: 'Turkish' },
  { code: 'uk-UA', country: 'ua', name: 'Ukrainian' }
];

export const getLanguageName = (code: string) =>
  languages.find((l) => l.code === code)?.name ?? code;

// SVG flag (flag-icons) — renders identically across all browsers/OSes,
// unlike emoji flags which Chrome on Windows cannot draw.
export const Flag: React.FC<{ code: string; className?: string }> = ({ code, className }) => {
  const country = languages.find((l) => l.code === code)?.country;
  if (!country) return <Globe size={14} aria-hidden="true" />;
  return <span className={`fi fi-${country} lang-flag${className ? ` ${className}` : ''}`} aria-hidden="true" />;
};

interface LangDropdownProps {
  value: string;
  onChange: (code: string) => void;
  ariaLabel: string;
  compact?: boolean;
}

const LangDropdown: React.FC<LangDropdownProps> = ({ value, onChange, ariaLabel, compact }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = languages.find((l) => l.code === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? languages.filter((l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
    : languages;

  const choose = (code: string) => {
    onChange(code);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={`lang-dd ${compact ? 'lang-dd-compact' : ''}`} ref={ref}>
      <button
        type="button"
        className="lang-dd-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="lang-dd-value">
          {selected ? (
            <>
              <Flag code={selected.code} /> {selected.name}
            </>
          ) : (
            'Chọn ngôn ngữ'
          )}
        </span>
        <ChevronDown size={14} className={`lang-dd-caret ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="lang-dd-menu" role="listbox">
          <div className="lang-dd-search">
            <Search size={13} />
            <input
              autoFocus
              className="lang-dd-search-input"
              placeholder="Tìm ngôn ngữ..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="lang-dd-list">
            {filtered.length === 0 ? (
              <div className="lang-dd-empty">Không tìm thấy ngôn ngữ</div>
            ) : (
              filtered.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="option"
                  aria-selected={l.code === value}
                  className={`lang-dd-option ${l.code === value ? 'active' : ''}`}
                  onClick={() => choose(l.code)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Flag code={l.code} /> {l.name}
                  </span>
                  {l.code === value && <Check size={13} />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  sourceLang,
  setSourceLang,
  targetLang,
  setTargetLang,
  compact = false,
}) => {
  const swapLanguages = () => {
    const temp = sourceLang;
    setSourceLang(targetLang);
    setTargetLang(temp);
  };

  if (compact) {
    return (
      <div className="lang-selector-compact">
        <LangDropdown value={sourceLang} onChange={setSourceLang} ariaLabel="Ngôn ngữ nguồn" compact />

        <button className="swap-btn swap-btn-compact" onClick={swapLanguages} title="Đảo ngược hai ngôn ngữ">
          <ArrowLeftRight size={12} />
        </button>

        <LangDropdown value={targetLang} onChange={setTargetLang} ariaLabel="Ngôn ngữ đích" compact />
      </div>
    );
  }

  return (
    <div className="panel-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <h2 style={{ fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Globe size={18} className="logo-icon" />
        Cấu hình ngôn ngữ
      </h2>

      <div className="lang-selector-grid">
        <div className="input-group">
          <label className="input-label">Ngôn ngữ nguồn</label>
          <LangDropdown value={sourceLang} onChange={setSourceLang} ariaLabel="Ngôn ngữ nguồn" />
        </div>

        <button className="swap-btn" onClick={swapLanguages} title="Đảo ngược hai ngôn ngữ">
          <ArrowLeftRight size={14} />
        </button>

        <div className="input-group">
          <label className="input-label">Ngôn ngữ đích</label>
          <LangDropdown value={targetLang} onChange={setTargetLang} ariaLabel="Ngôn ngữ đích" />
        </div>
      </div>
    </div>
  );
};
