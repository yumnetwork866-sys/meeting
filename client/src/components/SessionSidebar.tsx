import React, { useEffect, useState } from 'react';
import { Plus, Check, X, Pencil, Trash2, Download } from 'lucide-react';
import type { SessionMeta } from '../hooks/useSessions';
import { EXPORT_FORMATS, type ExportFormat } from '../utils/exportTranscripts';
import { useConfirm } from './ConfirmDialog';

interface SessionSidebarProps {
  sessions: SessionMeta[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string, format: ExportFormat) => void;
}


export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExport,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [exportId, setExportId] = useState<string | null>(null);
  const confirm = useConfirm();

  // Close the export menu on any outside click / Escape.
  useEffect(() => {
    if (!exportId) return;
    const close = () => setExportId(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [exportId]);

  const startEdit = (s: SessionMeta) => {
    setEditingId(s.id);
    setDraft(s.title);
  };

  const commitEdit = () => {
    if (editingId && draft.trim()) onRename(editingId, draft);
    setEditingId(null);
    setDraft('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  return (
    <div className="session-sidebar">
      <div className="session-sidebar-header">
        <button className="btn btn-primary session-new-btn" onClick={onCreate} title="Tạo phiên mới">
          <Plus size={14} />
          <span>Thêm</span>
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0
          ? null
          : sessions.map((s) => {
                const isActive = s.id === activeId;
                const isEditing = s.id === editingId;
                return (
                  <div
                    key={s.id}
                    className={`session-item ${isActive ? 'active' : ''}`}
                    onClick={() => !isEditing && onSelect(s.id)}
                  >
                    {isEditing ? (
                      <div className="session-edit-row" onClick={(e) => e.stopPropagation()}>
                        <input
                          className="input-control session-edit-input"
                          value={draft}
                          autoFocus
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit();
                            if (e.key === 'Escape') cancelEdit();
                          }}
                        />
                        <button className="session-icon-btn" onClick={commitEdit} title="Lưu">
                          <Check size={13} />
                        </button>
                        <button className="session-icon-btn" onClick={cancelEdit} title="Huỷ">
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="session-item-main">
                          <span className="session-item-title">{s.title}</span>
                        </div>
                        <div className="session-item-actions">
                          <div className="session-export-wrap">
                            <button
                              className="session-icon-btn"
                              title="Tải xuống"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportId((cur) => (cur === s.id ? null : s.id));
                              }}
                            >
                              <Download size={13} />
                            </button>
                            {exportId === s.id && (
                              <div className="session-export-menu" onClick={(e) => e.stopPropagation()}>
                                {EXPORT_FORMATS.map((f) => (
                                  <button
                                    key={f.value}
                                    className="session-export-option"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onExport(s.id, f.value);
                                      setExportId(null);
                                    }}
                                  >
                                    {f.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <button
                            className="session-icon-btn"
                            title="Đổi tên"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(s);
                            }}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="session-icon-btn session-icon-danger"
                            title="Xoá phiên"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const ok = await confirm({
                                title: 'Xoá phiên',
                                message: `Xoá phiên "${s.title}" và toàn bộ nội dung?`,
                                confirmText: 'Xoá',
                                danger: true,
                              });
                              if (ok) onDelete(s.id);
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
      </div>
    </div>
  );
};
