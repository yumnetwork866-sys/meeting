import React, { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw, Trash2, KeyRound, UserPlus, Loader2, CheckCircle2, Ban } from 'lucide-react';
import { useConfirm } from './ConfirmDialog';
import { CustomSelect } from './CustomSelect';

type UserRole = 'admin' | 'user';
type RoleFilter = 'all' | UserRole;
type AdminSection = 'users' | 'audit' | 'settings';
type UserSortBy = 'username' | 'createdAt' | 'lastActiveAt' | 'sessionCount' | 'transcriptCount' | 'role';

export interface AdminUser {
  id: string;
  username: string;
  createdAt: string;
  model: string;
  hasApiKey: boolean;
  sessionCount: number;
  transcriptCount: number;
  lastActiveAt: string | null;
  mustChangePassword: boolean;
  approved: boolean;
  isAdmin: boolean;
  role: UserRole;
}

interface AdminSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  transcriptCount: number;
}

interface AuditLog {
  id: string;
  actorUsername: string;
  action: string;
  targetUsername: string | null;
  details: string;
  createdAt: string;
}

interface AdminSettings {
  publicRegistrationEnabled: boolean;
  requireAdminApproval: boolean;
}

interface AdminDashboardProps {
  token: string;
  currentUserId: string;
  onClose: () => void;
  onShowToast: (message: string) => void;
  section?: AdminSection;
  variant?: 'modal' | 'page';
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

const actionLabel = (action: string) => {
  switch (action) {
    case 'create_user':
      return 'Tạo user';
    case 'delete_user':
      return 'Xoá user';
    case 'reset_password':
      return 'Đặt lại mật khẩu';
    case 'change_role':
      return 'Đổi vai trò';
    case 'approve_user':
      return 'Duyệt user';
    case 'suspend_user':
      return 'Khoá user';
    case 'update_settings':
      return 'Đổi settings';
    default:
      return action;
  }
};

const roleOptions = [
  { value: 'user', label: 'user' },
  { value: 'admin', label: 'admin' },
];

const roleFilterOptions = [
  { value: 'all', label: 'Tất cả vai trò' },
  { value: 'admin', label: 'Admin' },
  { value: 'user', label: 'User' },
];

const pageSizes = [10, 25, 50];

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  token,
  currentUserId,
  onClose,
  onShowToast,
  section = 'users',
  variant = 'modal',
}) => {
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [selectedSessions, setSelectedSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [savingSetting, setSavingSetting] = useState<keyof AdminSettings | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetMustChangePassword, setResetMustChangePassword] = useState(true);

  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalUsers, setTotalUsers] = useState(0);
  const [sortBy, setSortBy] = useState<UserSortBy>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [newMustChangePassword, setNewMustChangePassword] = useState(true);
  const [creating, setCreating] = useState(false);

  const authHeaders = useCallback(
    (json = false): Record<string, string> => {
      const h: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (json) h['Content-Type'] = 'application/json';
      return h;
    },
    [token]
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      });
      if (query.trim()) params.set('query', query.trim());
      if (roleFilter !== 'all') params.set('role', roleFilter);
      const res = await fetch(`/api/admin/users?${params.toString()}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      setUsers(data.users || []);
      setTotalUsers(data.total || 0);
    } catch {
      onShowToast('❌ Không tải được danh sách người dùng.');
    } finally {
      setLoading(false);
    }
  }, [authHeaders, onShowToast, page, pageSize, query, roleFilter, sortBy, sortDir]);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetch('/api/admin/audit-logs?limit=30', { headers: authHeaders() });
      if (!res.ok) throw new Error('audit failed');
      const data = await res.json();
      setAuditLogs(data.logs || []);
    } catch {
      onShowToast('❌ Không tải được audit log.');
    } finally {
      setAuditLoading(false);
    }
  }, [authHeaders, onShowToast]);

  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch('/api/admin/settings', { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'settings failed');
      setSettings(data.settings);
    } catch {
      onShowToast('❌ Không tải được admin settings.');
    } finally {
      setSettingsLoading(false);
    }
  }, [authHeaders, onShowToast]);

  const loadUserDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/admin/users/${id}`, { headers: authHeaders() });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Không tải được chi tiết user.');
        setSelectedUser(data.user);
        setSelectedSessions(data.sessions || []);
      } catch (err: any) {
        onShowToast(`❌ ${err.message || 'Không tải được chi tiết user.'}`);
      } finally {
        setDetailLoading(false);
      }
    },
    [authHeaders, onShowToast]
  );

  const refreshAll = useCallback(() => {
    loadUsers();
    loadAuditLogs();
    loadSettings();
    if (selectedUser) loadUserDetail(selectedUser.id);
  }, [loadAuditLogs, loadSettings, loadUserDetail, loadUsers, selectedUser]);

  useEffect(() => {
    loadUsers();
    loadAuditLogs();
    loadSettings();
  }, [loadAuditLogs, loadSettings, loadUsers]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (resetTarget) setResetTarget(null);
        else onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, resetTarget]);

  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));

  useEffect(() => {
    setPage(1);
  }, [query, roleFilter, pageSize, sortBy, sortDir]);

  const sortUsers = (nextSortBy: UserSortBy) => {
    if (sortBy === nextSortBy) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(nextSortBy);
    setSortDir('asc');
  };

  const sortMark = (key: UserSortBy) => sortBy === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) return;
    setCreating(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
          mustChangePassword: newMustChangePassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Tạo user thất bại.');
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setNewMustChangePassword(true);
      loadUsers();
      loadAuditLogs();
    } catch (err: any) {
      onShowToast(`❌ ${err.message || 'Tạo user thất bại.'}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (u: AdminUser, role: UserRole) => {
    if (u.role === role) return;
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/role`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Đổi vai trò thất bại.');
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...data.user } : x)));
      if (selectedUser?.id === u.id) loadUserDetail(u.id);
      loadAuditLogs();
    } catch (err: any) {
      onShowToast(`❌ ${err.message || 'Đổi vai trò thất bại.'}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleApprovalChange = async (u: AdminUser, approved: boolean) => {
    if (u.approved === approved) return;
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/approval`, {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ approved }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Cập nhật trạng thái thất bại.');
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...data.user } : x)));
      if (selectedUser?.id === u.id) loadUserDetail(u.id);
      loadAuditLogs();
    } catch (err: any) {
      onShowToast(`❌ ${err.message || 'Cập nhật trạng thái thất bại.'}`);
    } finally {
      setBusyId(null);
    }
  };

  const updateSetting = async (key: keyof AdminSettings, value: boolean) => {
    setSavingSetting(key);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: authHeaders(true),
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Lưu setting thất bại.');
      setSettings(data.settings);
      loadAuditLogs();
    } catch (err: any) {
      onShowToast(`❌ ${err.message || 'Lưu setting thất bại.'}`);
    } finally {
      setSavingSetting(null);
    }
  };

  const handleDelete = async (u: AdminUser) => {
    const ok = await confirm({
      title: 'Xoá người dùng',
      message: `Xoá "${u.username}" và toàn bộ phiên/đoạn dịch của họ? Hành động này không thể hoàn tác.`,
      danger: true,
      confirmText: 'Xoá',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Xoá thất bại.');
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      if (selectedUser?.id === u.id) {
        setSelectedUser(null);
        setSelectedSessions([]);
      }
      loadAuditLogs();
    } catch (err: any) {
      onShowToast(`❌ ${err.message || 'Xoá thất bại.'}`);
    } finally {
      setBusyId(null);
    }
  };

  const openResetPassword = (u: AdminUser) => {
    setResetTarget(u);
    setResetPassword('');
    setResetMustChangePassword(true);
  };

  const submitResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < 6) {
      onShowToast('❌ Password tối thiểu 6 ký tự.');
      return;
    }
    setBusyId(resetTarget.id);
    try {
      const res = await fetch(`/api/admin/users/${resetTarget.id}/reset-password`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          password: resetPassword,
          mustChangePassword: resetMustChangePassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Đặt lại mật khẩu thất bại.');
      loadUsers();
      loadAuditLogs();
      setResetTarget(null);
      setResetPassword('');
    } catch (err: any) {
      onShowToast(`❌ ${err.message || 'Đặt lại mật khẩu thất bại.'}`);
    } finally {
      setBusyId(null);
    }
  };

  const dashboard = (
    <div
      className={`admin-dash ${variant === 'page' ? 'admin-dash-page' : ''}`}
      role={variant === 'modal' ? 'dialog' : 'main'}
      aria-modal={variant === 'modal' ? 'true' : undefined}
      aria-label="Quản trị người dùng"
      onClick={variant === 'modal' ? (e) => e.stopPropagation() : undefined}
    >
      <div className="admin-dash-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button className="topbar-icon-btn" onClick={refreshAll} title="Tải lại" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="topbar-icon-btn" onClick={onClose} title="Đóng">
            <X size={16} />
          </button>
        </div>
      </div>

      {section === 'users' && (
      <>
      <form className="admin-create-row" onSubmit={handleCreate}>
        <input
          className="input-control"
          placeholder="Tên đăng nhập mới"
          value={newUsername}
          onChange={(e) => setNewUsername(e.target.value)}
          autoComplete="off"
        />
        <input
          className="input-control"
          type="password"
          placeholder="Mật khẩu (>= 6 ký tự)"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />
        <CustomSelect
          className="admin-role-select"
          triggerClassName="input-control admin-select-trigger"
          ariaLabel="Chọn vai trò người dùng mới"
          value={newRole}
          options={roleOptions}
          onChange={(value) => setNewRole(value as UserRole)}
        />
        <label className="admin-check">
          <input
            type="checkbox"
            checked={newMustChangePassword}
            onChange={(e) => setNewMustChangePassword(e.target.checked)}
          />
          Đổi khi login
        </label>
        <button className="btn btn-primary" type="submit" disabled={creating}>
          {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          Tạo
        </button>
      </form>

      <div className="admin-toolbar">
        <input
          className="input-control"
          placeholder="Tìm username..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <CustomSelect
          className="admin-role-select"
          triggerClassName="input-control admin-select-trigger"
          ariaLabel="Lọc vai trò"
          value={roleFilter}
          options={roleFilterOptions}
          onChange={(value) => setRoleFilter(value as RoleFilter)}
        />
        <CustomSelect
          className="admin-role-select"
          triggerClassName="input-control admin-select-trigger"
          ariaLabel="Chọn số user mỗi trang"
          value={String(pageSize)}
          options={pageSizes.map((size) => ({ value: String(size), label: `${size}/page` }))}
          onChange={(value) => setPageSize(Number(value))}
        />
        <span className="admin-count">{totalUsers} users</span>
      </div>

      <div className="admin-table-wrap">
        {loading ? (
          <div className="admin-empty">
            <Loader2 size={20} className="animate-spin" /> Đang tải...
          </div>
        ) : users.length === 0 ? (
          <div className="admin-empty">Không có người dùng phù hợp.</div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th><button className="admin-sort" onClick={() => sortUsers('username')}>Người dùng{sortMark('username')}</button></th>
                <th><button className="admin-sort" onClick={() => sortUsers('role')}>Vai trò{sortMark('role')}</button></th>
                <th><button className="admin-sort" onClick={() => sortUsers('createdAt')}>Tạo lúc{sortMark('createdAt')}</button></th>
                <th><button className="admin-sort" onClick={() => sortUsers('lastActiveAt')}>Hoạt động cuối{sortMark('lastActiveAt')}</button></th>
                <th className="num"><button className="admin-sort" onClick={() => sortUsers('sessionCount')}>Phiên{sortMark('sessionCount')}</button></th>
                <th className="num"><button className="admin-sort" onClick={() => sortUsers('transcriptCount')}>Đoạn dịch{sortMark('transcriptCount')}</button></th>
                <th>API key</th>
                <th>Trạng thái</th>
                <th className="actions-col">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUserId;
                return (
                  <tr key={u.id}>
                    <td>
                      <button className="admin-user-link" onClick={() => loadUserDetail(u.id)}>
                        {u.username}
                      </button>
                      {isSelf && <span className="admin-badge self">bạn</span>}
                    </td>
                    <td>
                      <CustomSelect
                        className="admin-role-chip-select"
                        triggerClassName="admin-role-chip"
                        menuClassName="admin-role-chip-menu"
                        ariaLabel={`Đổi vai trò của ${u.username}`}
                        value={u.role}
                        options={roleOptions}
                        onChange={(value) => handleRoleChange(u, value as UserRole)}
                        disabled={busyId === u.id || isSelf}
                        title={isSelf ? 'Không thể đổi vai trò chính bạn' : 'Đổi vai trò'}
                      />
                    </td>
                    <td className="font-mono admin-dim">{fmtDate(u.createdAt)}</td>
                    <td className="font-mono admin-dim">{fmtDate(u.lastActiveAt)}</td>
                    <td className="num">{u.sessionCount}</td>
                    <td className="num">{u.transcriptCount}</td>
                    <td>{u.hasApiKey ? '✓' : '-'}</td>
                    <td>
                      {u.approved ? (
                        u.mustChangePassword ? <span className="admin-badge user">đổi mật khẩu</span> : <span className="admin-badge approved">approved</span>
                      ) : (
                        <span className="admin-badge pending">chờ duyệt</span>
                      )}
                    </td>
                    <td className="actions-col">
                      {u.approved ? (
                        <button
                          className="icon-action"
                          title={isSelf ? 'Không thể khoá chính bạn' : 'Khoá tài khoản'}
                          onClick={() => handleApprovalChange(u, false)}
                          disabled={isSelf || busyId === u.id}
                        >
                          <Ban size={14} />
                        </button>
                      ) : (
                        <button
                          className="icon-action success"
                          title="Duyệt tài khoản"
                          onClick={() => handleApprovalChange(u, true)}
                          disabled={busyId === u.id}
                        >
                          <CheckCircle2 size={14} />
                        </button>
                      )}
                      <button
                        className="icon-action"
                        title="Đặt lại mật khẩu"
                        onClick={() => openResetPassword(u)}
                        disabled={busyId === u.id}
                      >
                        <KeyRound size={14} />
                      </button>
                      <button
                        className="icon-action danger"
                        title={isSelf ? 'Không thể xoá chính bạn' : 'Xoá người dùng'}
                        onClick={() => handleDelete(u)}
                        disabled={isSelf || busyId === u.id}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="admin-pagination">
        <button className="btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading}>
          Trước
        </button>
        <span className="font-mono">Trang {page}/{totalPages}</span>
        <button className="btn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading}>
          Sau
        </button>
      </div>

      <div className="admin-lower-grid">
        <section className="admin-detail-panel">
          <div className="admin-section-header">
            <h3>Chi tiết user</h3>
            {detailLoading && <Loader2 size={14} className="animate-spin" />}
          </div>
          {selectedUser ? (
            <>
              <div className="admin-detail-stats">
                <span><strong>{selectedUser.username}</strong></span>
                <span className={`admin-badge ${selectedUser.role === 'admin' ? '' : 'user'}`}>{selectedUser.role}</span>
                <span className={`admin-badge ${selectedUser.approved ? 'approved' : 'pending'}`}>
                  {selectedUser.approved ? 'approved' : 'chờ duyệt'}
                </span>
                {selectedUser.mustChangePassword && <span className="admin-badge user">đổi mật khẩu khi login</span>}
                <span>{selectedUser.sessionCount} phiên</span>
                <span>{selectedUser.transcriptCount} đoạn dịch</span>
                <span>{selectedUser.hasApiKey ? 'Có API key' : 'Chưa có API key'}</span>
              </div>
              <div className="admin-session-list">
                {selectedSessions.length === 0 ? (
                  <div className="admin-empty compact">Chưa có phiên nào.</div>
                ) : (
                  selectedSessions.map((s) => (
                    <div className="admin-session-row" key={s.id}>
                      <div>
                        <strong>{s.title || 'Untitled session'}</strong>
                        <span className="admin-dim">{fmtDate(s.updatedAt)}</span>
                      </div>
                      <span>{s.transcriptCount} đoạn</span>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="admin-empty compact">Chọn một username để xem chi tiết.</div>
          )}
        </section>

      </div>
      </>
      )}

      {section === 'audit' && (
        <section className="admin-audit-panel admin-section-full">
          <div className="admin-section-header">
            <h3>Audit log</h3>
            {auditLoading && <Loader2 size={14} className="animate-spin" />}
          </div>
          <div className="admin-audit-list">
            {auditLogs.length === 0 ? (
              <div className="admin-empty compact">Chưa có audit log.</div>
            ) : (
              auditLogs.map((log) => (
                <div className="admin-audit-row" key={log.id}>
                  <span>{actionLabel(log.action)}</span>
                  <strong>{log.targetUsername || '-'}</strong>
                  <span className="admin-dim">bởi {log.actorUsername}</span>
                  {log.details && <span className="admin-dim">{log.details}</span>}
                  <span className="font-mono admin-dim">{fmtDate(log.createdAt)}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {section === 'settings' && (
        <section className="admin-detail-panel admin-section-full">
          <div className="admin-section-header">
            <h3>Cài đặt quản trị</h3>
            {settingsLoading && <Loader2 size={14} className="animate-spin" />}
          </div>
          <div className="admin-settings-list">
            <div>
              <strong>Đăng ký công khai</strong>
              <span className="admin-dim">Cho phép người dùng tự tạo tài khoản từ trang đăng nhập.</span>
              <label className="admin-switch">
                <input
                  type="checkbox"
                  checked={!!settings?.publicRegistrationEnabled}
                  disabled={!settings || savingSetting === 'publicRegistrationEnabled'}
                  onChange={(e) => updateSetting('publicRegistrationEnabled', e.target.checked)}
                />
                <span className="admin-switch-track" aria-hidden="true" />
                <span>{settings?.publicRegistrationEnabled ? 'Đang bật' : 'Đang tắt'}</span>
              </label>
            </div>
            <div>
              <strong>Yêu cầu admin duyệt</strong>
              <span className="admin-dim">Tài khoản tự đăng ký phải được admin duyệt trước khi đăng nhập.</span>
              <label className="admin-switch">
                <input
                  type="checkbox"
                  checked={!!settings?.requireAdminApproval}
                  disabled={!settings || savingSetting === 'requireAdminApproval'}
                  onChange={(e) => updateSetting('requireAdminApproval', e.target.checked)}
                />
                <span className="admin-switch-track" aria-hidden="true" />
                <span>{settings?.requireAdminApproval ? 'Bắt buộc duyệt' : 'Không cần duyệt'}</span>
              </label>
            </div>
            <div>
              <strong>Admin khởi tạo</strong>
              <span className="admin-dim">Admin ban đầu vẫn lấy từ server/.env bằng ADMIN_USERNAME. Quyền truy cập khi chạy app được quản lý bằng vai trò trong database.</span>
            </div>
          </div>
        </section>
      )}

    </div>
  );

  const resetDialog = resetTarget ? (
    <div className="modal-overlay" onClick={() => setResetTarget(null)}>
      <form className="modal-card" onSubmit={submitResetPassword} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <KeyRound size={16} className="logo-icon" />
          <h3 className="modal-title">Đặt lại mật khẩu</h3>
        </div>
        <p className="modal-message">Mật khẩu mới cho "{resetTarget.username}" phải có ít nhất 6 ký tự.</p>
        <label className="admin-check modal-check">
          <input
            type="checkbox"
            checked={resetMustChangePassword}
            onChange={(e) => setResetMustChangePassword(e.target.checked)}
          />
          Bắt đổi mật khẩu khi login
        </label>
        <input
          className="input-control"
          type="password"
          value={resetPassword}
          onChange={(e) => setResetPassword(e.target.value)}
          autoComplete="new-password"
          autoFocus
        />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => setResetTarget(null)}>
            Huỷ
          </button>
          <button type="submit" className="btn btn-primary" disabled={busyId === resetTarget.id}>
            {busyId === resetTarget.id && <Loader2 size={14} className="animate-spin" />}
            Đặt lại
          </button>
        </div>
      </form>
    </div>
  ) : null;

  if (variant === 'page') {
    return (
      <>
        {dashboard}
        {resetDialog}
      </>
    );
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        {dashboard}
      </div>
      {resetDialog}
    </>
  );
};
