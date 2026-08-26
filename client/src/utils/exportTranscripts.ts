import type { TranscriptItem } from '../hooks/useTranslator';

export type ExportFormat = 'md' | 'txt' | 'json';

export const EXPORT_FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'txt', label: 'Văn bản (.txt)' },
  { value: 'json', label: 'JSON (.json)' },
];

const lowerCode = (lang: string) => lang.split('-')[0].toLowerCase();

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function normalizePreferredLanguage(preferredLanguage?: string | null): string {
  return preferredLanguage ? preferredLanguage.trim() : '';
}

function isLanguageItem(item: TranscriptItem, preferredLanguage: string): boolean {
  if (!preferredLanguage) return true;
  return item.sourceLang === preferredLanguage || item.targetLang === preferredLanguage;
}

function buildTranscriptLines(item: TranscriptItem, preferredLanguage: string): string[] {
  const time = formatTime(item.timestamp);
  if (!preferredLanguage) {
    return [
      `[${time}-${lowerCode(item.sourceLang)}]: ${item.originalText}`,
      `[${time}-${lowerCode(item.targetLang)}]: ${item.translatedText}`,
    ];
  }

  if (item.sourceLang === preferredLanguage) {
    return [`[${time}-${lowerCode(preferredLanguage)}]: ${item.originalText}`];
  }

  return [`[${time}-${lowerCode(preferredLanguage)}]: ${item.translatedText}`];
}

function buildMarkdown(title: string, items: TranscriptItem[], preferredLanguage?: string | null): string {
  const lang = normalizePreferredLanguage(preferredLanguage);
  const filtered = items.filter((item) => isLanguageItem(item, lang));
  let md = `# ${title} - SpeakLink\n`;
  md += `Xuất lúc: ${new Date().toLocaleString('vi-VN')}\n`;
  md += `Tổng số đoạn dịch: ${filtered.length}\n\n`;
  md += `=========================================================\n\n`;

  filtered.forEach((item) => {
    buildTranscriptLines(item, lang).forEach((line) => {
      md += `${line}\n`;
    });
    md += `---\n\n`;
  });

  return md;
}

function buildText(title: string, items: TranscriptItem[], preferredLanguage?: string | null): string {
  const lang = normalizePreferredLanguage(preferredLanguage);
  const filtered = items.filter((item) => isLanguageItem(item, lang));
  let txt = `${title} - SpeakLink\n`;
  txt += `Xuất lúc: ${new Date().toLocaleString('vi-VN')}\n`;
  txt += `Tổng số đoạn dịch: ${filtered.length}\n\n`;

  filtered.forEach((item) => {
    buildTranscriptLines(item, lang).forEach((line) => {
      txt += `${line}\n`;
    });
    txt += `\n`;
  });

  return txt;
}

export function buildExport(
  title: string,
  items: TranscriptItem[],
  format: ExportFormat,
  preferredLanguage?: string | null
): { content: string; mime: string; ext: string } {
  switch (format) {
    case 'txt':
      return { content: buildText(title, items, preferredLanguage), mime: 'text/plain;charset=utf-8;', ext: 'txt' };
    case 'json':
      return {
        content: JSON.stringify(
          {
            title,
            exportedAt: new Date().toISOString(),
            transcripts: items.filter((item) => isLanguageItem(item, normalizePreferredLanguage(preferredLanguage))),
            preferredLanguage: normalizePreferredLanguage(preferredLanguage) || null,
          },
          null,
          2
        ),
        mime: 'application/json;charset=utf-8;',
        ext: 'json',
      };
    case 'md':
    default:
      return { content: buildMarkdown(title, items, preferredLanguage), mime: 'text/markdown;charset=utf-8;', ext: 'md' };
  }
}

export function downloadExport(
  filenameBase: string,
  items: TranscriptItem[],
  format: ExportFormat,
  preferredLanguage?: string | null
): void {
  const { content, mime, ext } = buildExport(filenameBase, items, format, preferredLanguage);
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const safeName = filenameBase.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'SpeakLink';
  const dateStr = new Date().toISOString().slice(0, 10);
  link.setAttribute('download', `${safeName}_${dateStr}.${ext}`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
