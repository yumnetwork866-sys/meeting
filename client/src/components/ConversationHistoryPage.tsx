import React, { useCallback, useEffect, useState } from 'react';
import { Download, History, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import { Flag, getLanguageName, languages } from './LanguageSelector';
import { useConfirm } from './ConfirmDialog';
import { EXPORT_FORMATS, downloadExport, type ExportFormat } from '../utils/exportTranscripts';
import type { TranscriptItem } from '../hooks/useTranslator';

interface ConversationHistoryPageProps {
  token: string;
  onShowToast: (message: string) => void;
}

interface HistoryRoom {
  id: string;
  roomCode: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  createdAt: string;
  closedAt: string | null;
  transcriptCount: number;
}

interface HistoryTranscript {
  id: string;
  exportId: string;
  roomCode: string;
  speakerId: string | null;
  speakerName: string;
  originalText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
}

interface HistoryFilters {
  state: 'closed' | 'open' | 'all';
  lang: string;
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

export const ConversationHistoryPage: React.FC<ConversationHistoryPageProps> = ({ token, onShowToast }) => {
  const [rooms, setRooms] = useState<HistoryRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<HistoryRoom | null>(null);
  const [transcripts, setTranscripts] = useState<HistoryTranscript[]>([]);
  const [viewLang, setViewLang] = useState<'all' | string>('all');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<ExportFormat>('md');
  const [searchQuery, setSearchQuery] = useState('');
  const [filters, setFilters] = useState<HistoryFilters>({
    state: 'closed',
    lang: '',
  });
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const confirm = useConfirm();

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('limit', '200');
      params.set('state', filters.state);
      if (filters.lang) params.set('lang', filters.lang);

      const res = await fetch(`/api/team-live/history?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'load history failed');
      const nextRooms = data.rooms || [];
      setRooms(nextRooms);
      setSelectedRoom((prev) => {
        if (prev && nextRooms.some((room: HistoryRoom) => room.id === prev.id)) return prev;
        return nextRooms[0] || null;
      });
      if (nextRooms.length === 0) setTranscripts([]);
    } catch (err: any) {
      onShowToast(`${err?.message || 'Không tải được lịch sử hội thoại.'}`);
    } finally {
      setLoading(false);
    }
  }, [filters, onShowToast, token]);

  const loadRoomDetail = useCallback(async (roomCode: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/team-live/history/${encodeURIComponent(roomCode)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'load history detail failed');
      setTranscripts(data.transcripts || []);
    } catch (err: any) {
      setSelectedRoom(null);
      setTranscripts([]);
      onShowToast(`${err?.message || 'Không tải được nội dung hội thoại.'}`);
    } finally {
      setDetailLoading(false);
    }
  }, [onShowToast, token]);

  const deleteSelectedRoom = useCallback(async () => {
    if (!selectedRoom || deleteLoading) return;

    const ok = await confirm({
      title: 'Xóa hội thoại',
      message: `Xóa vĩnh viễn hội thoại ${selectedRoom.roomCode}? Hành động này sẽ xóa toàn bộ transcript liên quan và không thể khôi phục.`,
      confirmText: 'Xóa',
      cancelText: 'Hủy',
      danger: true,
    });

    if (!ok) return;

    setDeleteLoading(true);
    try {
      const res = await fetch(`/api/team-live/history/export/${encodeURIComponent(selectedRoom.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'delete history failed');

      onShowToast(`Đã xóa hội thoại ${selectedRoom.roomCode}.`);
      setSelectedRoom(null);
      setTranscripts([]);
      await loadRooms();
    } catch (err: any) {
      onShowToast(`${err?.message || 'Không xóa được hội thoại.'}`);
    } finally {
      setDeleteLoading(false);
    }
  }, [confirm, deleteLoading, loadRooms, onShowToast, selectedRoom, token]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadRooms();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadRooms]);

  useEffect(() => {
    if (!selectedRoom) return;
    void loadRoomDetail(selectedRoom.roomCode);
  }, [loadRoomDetail, selectedRoom]);

  useEffect(() => {
    if (filters.lang) {
      setViewLang(filters.lang);
      return;
    }

    if (!selectedRoom || viewLang === 'all') return;
    if (viewLang !== selectedRoom.sourceLang && viewLang !== selectedRoom.targetLang) {
      setViewLang('all');
    }
  }, [filters.lang, selectedRoom, viewLang]);

  const activeLanguage = filters.lang || (viewLang === 'all' ? '' : viewLang);
  const activeLanguageCode = activeLanguage ? activeLanguage.split('-')[0].toUpperCase() : '';
  const getTranscriptTextForLanguage = (item: HistoryTranscript) => {
    if (!activeLanguage) return null;
    if (item.sourceLang === activeLanguage) return item.originalText;
    if (item.targetLang === activeLanguage) return item.translatedText;
    return null;
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const visibleTranscripts = transcripts.filter((item) => {
    const filteredText = getTranscriptTextForLanguage(item);
    if (activeLanguage && filteredText === null) return false;

    if (!normalizedSearch) return true;
    const searchTarget = [
      item.speakerName,
      item.originalText,
      item.translatedText,
      filteredText || '',
      item.sourceLang,
      item.targetLang,
    ]
      .join(' ')
      .toLowerCase();
    return searchTarget.includes(normalizedSearch);
  });

  const handleDownload = () => {
    if (!selectedRoom) return;
    const items: TranscriptItem[] = transcripts.map((item) => ({
      id: item.id,
      timestamp: item.createdAt,
      originalText: item.originalText,
      translatedText: item.translatedText,
      sourceLang: item.sourceLang,
      targetLang: item.targetLang,
      speakerId: item.speakerId || undefined,
      speakerName: item.speakerName || undefined,
    }));
    downloadExport(selectedRoom.roomCode, items, downloadFormat, activeLanguage || null);
    setDownloadOpen(false);
  };

  return (
    <div className="app-container team-mode-container">
      <div className="team-workspace team-history-workspace">
        <div className="team-history-filter-bar">
          <div className="team-history-filter-row">
            <div className="team-history-filter-item">
              <label className="input-label team-history-filter-label">Trạng thái</label>
              <CustomSelect
                value={filters.state}
                ariaLabel="Lọc theo trạng thái"
                triggerClassName="input-control team-history-filter-trigger"
                menuClassName="team-history-filter-menu"
                options={[
                  { value: 'closed', label: 'Đã đóng' },
                  { value: 'open', label: 'Đang mở' },
                  { value: 'all', label: 'Tất cả' },
                ]}
                onChange={(state) => setFilters((prev) => ({ ...prev, state: state as HistoryFilters['state'] }))}
              />
            </div>
            <div className="team-history-filter-item">
              <label className="input-label team-history-filter-label">Ngôn ngữ</label>
              <CustomSelect
                value={filters.lang}
                ariaLabel="Lọc theo ngôn ngữ nguồn"
                triggerClassName="input-control team-history-filter-trigger"
                menuClassName="team-history-filter-menu"
                options={[
                  { value: '', label: 'Tất cả' },
                  ...languages.map((lang) => ({
                    value: lang.code,
                    label: (
                      <span className="team-history-lang-option">
                        <Flag code={lang.code} />
                        <span>{getLanguageName(lang.code)}</span>
                      </span>
                    ),
                  })),
                ]}
                onChange={(lang) => setFilters((prev) => ({ ...prev, lang }))}
              />
            </div>
            <div className="input-group team-history-search-group">
              <label className="input-label team-history-filter-label">Tìm nội dung hội thoại</label>
              <div className="team-history-search-wrap">
                <Search size={13} className="team-history-search-icon" />
                <input
                  className="input-control team-history-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        <section className="team-join-panel panel-card team-history-layout">
          <div className="team-history-sidebar">
            <div className="team-lobby-subtitle team-history-titlebar">
              <div className="team-lobby-subtitle">
                <History size={14} />
                <strong>Lịch sử hội thoại</strong>
                {loading && <Loader2 size={14} className="animate-spin" />}
              </div>
              <button type="button" className="topbar-icon-btn" onClick={() => void loadRooms()} title="Tải lại">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
            {rooms.length === 0 ? (
              <div className="admin-empty compact">Không có hội thoại phù hợp với bộ lọc hiện tại.</div>
            ) : (
              <div className="team-history-list team-history-list-scroll">
                {rooms.map((room) => {
                  const isActive = selectedRoom?.id === room.id;
                  return (
                    <button
                      key={room.id}
                      type="button"
                      className={`team-history-row ${isActive ? 'active' : ''}`}
                      onClick={() => setSelectedRoom(room)}
                    >
                      <div>
                        <strong>{room.roomCode}</strong>
                        <span className="admin-dim">{room.transcriptCount} đoạn</span>
                      </div>
                      <span className="team-history-chip">
                        {room.sourceLang.split('-')[0].toUpperCase()}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="team-history-detail">
            {selectedRoom ? (
              <>
                <div className="team-history-detail-toolbar">
                  <div className="team-lobby-subtitle">
                    <History size={14} />
                    <strong>{selectedRoom.roomCode}</strong>
                  </div>
                  <div className="team-history-toolbar-actions">
                    <div className="team-history-view-toggle" role="group" aria-label="Chọn ngôn ngữ hiển thị">
                      {[
                        { value: 'all', label: 'Cả hai' },
                        ...(selectedRoom
                          ? [selectedRoom.sourceLang, selectedRoom.targetLang]
                              .filter((lang, index, arr) => arr.indexOf(lang) === index)
                              .map((lang) => ({ value: lang, label: lang.split('-')[0].toUpperCase() }))
                          : []),
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={`team-history-toggle-btn ${viewLang === option.value ? 'active' : ''}`}
                          onClick={() => setViewLang(option.value)}
                          disabled={!!filters.lang && option.value !== filters.lang}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary team-history-download-btn"
                      onClick={() => setDownloadOpen(true)}
                      disabled={detailLoading || transcripts.length === 0}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger team-history-delete-btn"
                      onClick={() => void deleteSelectedRoom()}
                      disabled={deleteLoading || detailLoading}
                    >
                      {deleteLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
                <div className="team-history-detail-body">
                  {detailLoading ? (
                    <div className="admin-empty compact">
                      <Loader2 size={16} className="animate-spin" />
                      Đang tải nội dung...
                    </div>
                  ) : visibleTranscripts.length === 0 ? (
                    <div className="admin-empty compact">
                      {normalizedSearch ? 'Không tìm thấy nội dung phù hợp.' : 'Phòng này chưa có transcript.'}
                    </div>
                  ) : (
                    visibleTranscripts.map((item) => {
                      const filteredText = getTranscriptTextForLanguage(item);
                      return (
                        <div key={item.id} className="team-history-item">
                          <div className="admin-detail-stats team-history-meta">
                            <span><strong>{item.speakerName || 'Unknown speaker'}</strong></span>
                            <span className="admin-dim">{fmtDate(item.createdAt)}</span>
                          </div>
                          {activeLanguage ? (
                            <div className="team-history-bubble">
                              <span className="admin-dim">{activeLanguageCode}</span>
                              <p>{filteredText || 'Hội thoại trống'}</p>
                            </div>
                          ) : (
                            <>
                              <div className="team-history-bubble">
                                <span className="admin-dim">{item.sourceLang.split('-')[0].toUpperCase()}</span>
                                <p>{item.originalText || 'Hội thoại trống'}</p>
                              </div>
                              <div className="team-history-bubble">
                                <span className="admin-dim">{item.targetLang.split('-')[0].toUpperCase()}</span>
                                <p>{item.translatedText || 'Hội thoại trống'}</p>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="admin-empty compact">Chọn một hội thoại để xem nội dung.</div>
            )}
          </div>
        </section>
      </div>

      {downloadOpen && selectedRoom && (
        <div className="modal-overlay" onClick={() => setDownloadOpen(false)}>
          <div className="modal-card team-history-download-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <Download size={18} />
              <h3 className="modal-title">Chọn định dạng tải xuống</h3>
              <button
                type="button"
                className="topbar-icon-btn team-history-download-close-btn"
                onClick={() => setDownloadOpen(false)}
                aria-label="Đóng"
              >
                <X size={14} />
              </button>
            </div>
 
            <div className="team-history-download-grid">
              {EXPORT_FORMATS.map((format) => (
                <button
                  key={format.value}
                  type="button"
                  className={`team-history-download-option ${downloadFormat === format.value ? 'active' : ''}`}
                  onClick={() => setDownloadFormat(format.value)}
                >
                  {format.label}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setDownloadOpen(false)}>
                Huỷ
              </button>
              <button type="button" className="btn btn-primary" onClick={handleDownload}>
                Tải xuống
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
