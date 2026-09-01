import { useEffect, useState, useCallback } from 'react';
import {
  Bell,
  Send,
  Loader2,
  Users,
  CheckCircle2,
  Clock,
  XCircle,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Search,
  Plus,
  X,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';

const PAGE_SIZE = 15;
const SEARCH_PAGE = 30;

const CATEGORIES = [
  { key: 'announcement', label: 'Announcement' },
  { key: 'system', label: 'System notification' },
  { key: 'reminder', label: 'Reminder' },
  { key: 'promotion', label: 'Promotion' },
  { key: 'alert', label: 'Alert' },
];

const CATEGORY_BADGE = {
  announcement: 'bg-blue-50 text-blue-700',
  system: 'bg-slate-100 text-slate-600',
  reminder: 'bg-amber-50 text-amber-700',
  promotion: 'bg-violet-50 text-violet-700',
  alert: 'bg-red-50 text-red-700',
};

const STATUS_BADGE = {
  sent: 'bg-emerald-50 text-emerald-700',
  scheduled: 'bg-amber-50 text-amber-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

function ConfirmModal({ count, title, scheduleAt, onConfirm, onCancel, busy }) {
  const scheduled = Boolean(scheduleAt);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <Send className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-slate-900">
              {scheduled ? 'Schedule notification?' : 'Send notification?'}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {scheduled ? (
                <>
                  Schedule "<span className="font-semibold">{title}</span>" to{' '}
                  <span className="font-semibold">{formatDateTime(scheduleAt)}</span>?
                </>
              ) : (
                <>
                  Send "<span className="font-semibold">{title}</span>" to{' '}
                  <span className="font-semibold">{count.toLocaleString()}</span> user
                  {count === 1 ? '' : 's'}?
                </>
              )}
            </p>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition hover:bg-primary-dark disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {scheduled ? 'Schedule' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminNotifications() {
  const [history, setHistory] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('announcement');
  const [scope, setScope] = useState('all');
  const [role, setRole] = useState('user');
  const [schedule, setSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [recipientEstimate, setRecipientEstimate] = useState(0);
  const [selectedUsers, setSelectedUsers] = useState(new Set());
  const [search, setSearch] = useState('');
  const [userResults, setUserResults] = useState(null);
  // user picker (selected scope) — fetch when scope changes to 'selected'

  const loadHistory = useCallback((p) => {
    setError('');
    api(`/notifications/admin?page=${p}&pageSize=${PAGE_SIZE}`)
      .then(setHistory)
      .catch((err) => setError(err.message ?? 'Could not load notification history'));
  }, []);

  useEffect(() => {
    loadHistory(page);
  }, [page, loadHistory]);

  const estimateRecipients = useCallback(() => {
    const params = new URLSearchParams({ scope });
    if (scope === 'role') params.set('role', role);
    if (scope === 'selected' || scope === 'specific') {
      const ids = Array.from(selectedUsers);
      if (ids.length > 0) params.set('userIds', ids.join(','));
    }
    api(`/notifications/recipients?${params.toString()}`)
      .then((d) => setRecipientEstimate(d.count ?? 0))
      .catch(() => setRecipientEstimate(0));
  }, [scope, role, selectedUsers]);

  useEffect(() => {
    estimateRecipients();
  }, [estimateRecipients]);

  // Load user picker list when selected scope is active.
  useEffect(() => {
    if (scope !== 'selected') return;
    setUserResults(null);
    const t = setTimeout(() => {
      let active = true;
      const params = new URLSearchParams({ page: '1', pageSize: String(SEARCH_PAGE) });
      if (search.trim()) params.set('search', search.trim());
      api(`/admin/users?${params.toString()}`)
        .then((d) => active && setUserResults(d))
        .catch(() => active && setUserResults(null));
      return () => {
        active = false;
      };
    }, 300);
    return () => clearTimeout(t);
  }, [scope, search]);

  const toggleUser = (id) => {
    setSelectedUsers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalPages = history ? Math.max(1, Math.ceil(history.total / history.pageSize)) : 1;

  const resetForm = () => {
    setTitle('');
    setMessage('');
    setCategory('announcement');
    setScope('all');
    setRole('user');
    setSchedule(false);
    setScheduleAt('');
    setRecipientEstimate(0);
    setSelectedUsers(new Set());
    setSearch('');
  };

  const handleSend = async () => {
    setBusy(true);
    try {
      const body = { title, message, category, scope };
      if (scope === 'role') body.role = role;
      if (scope === 'selected' || scope === 'specific') body.userIds = Array.from(selectedUsers);
      if (schedule && scheduleAt) body.scheduleAt = new Date(scheduleAt).toISOString();
      await api('/notifications/send', { method: 'POST', body });
      setShowForm(false);
      setConfirm(null);
      resetForm();
      setPage(1);
      loadHistory(1);
      setError('');
    } catch (err) {
      setError(err.message ?? 'Failed to send notification');
    } finally {
      setBusy(false);
    }
  };

  const openSendForm = () => {
    setShowForm(true);
    setError('');
  };

  const submitClicked = () => {
    setConfirm({ count: recipientEstimate, title, scheduleAt: schedule && scheduleAt ? scheduleAt : null });
  };

  const handleCancelScheduled = async (id) => {
    if (!window.confirm('Cancel this scheduled notification?')) return;
    try {
      await api(`/notifications/admin/${id}/cancel`, { method: 'POST' });
      loadHistory(page);
    } catch (err) {
      setError(err.message ?? 'Failed to cancel notification');
    }
  };

  const formValid =
    title.trim().length >= 3 &&
    message.trim().length >= 3 &&
    (scope === 'selected' || scope === 'specific' ? selectedUsers.size > 0 : true) &&
    (schedule ? !!scheduleAt : true);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-slate-900">
            <Bell className="h-5 w-5 text-primary" /> Notifications
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Send announcements and system messages to members.</p>
        </div>
        <button onClick={openSendForm} className="btn-primary px-5 py-2.5 text-sm">
          <Plus className="h-4 w-4" /> Send Notification
        </button>
      </div>

      {error && <div className="mt-4 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

      {showForm && (
        <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-card">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="font-display text-lg font-bold text-slate-900">Send a new notification</h3>
            <button onClick={() => setShowForm(false)} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="label">Notification title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. New service available" className="input" />
            </div>
            <div>
              <label className="label">Notification type</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5">
            <label className="label">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder="Write the notification message..."
              className="input resize-none"
            />
            <p className="mt-1 text-right text-xs text-slate-400">{message.length}/2000</p>
          </div>

          <div className="mt-5">
            <label className="label">Recipients</label>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { key: 'all', label: 'All users' },
                { key: 'role', label: 'User group / role' },
                { key: 'selected', label: 'Selected users' },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setScope(opt.key)}
                  className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                    scope === opt.key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-slate-200 text-slate-600 hover:border-primary/40'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {scope === 'role' && (
              <select value={role} onChange={(e) => setRole(e.target.value)} className="input mt-3 sm:max-w-xs">
                <option value="user">All standard users</option>
                <option value="admin">All admins</option>
              </select>
            )}

            {scope === 'selected' && (
              <div className="mt-3 rounded-xl border border-slate-200 p-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or email..." className="input pl-9" />
                </div>
                <div className="mt-3 flex max-h-72 flex-col gap-1 overflow-auto pr-1">
                  {!userResults ? (
                    <div className="flex items-center justify-center py-6 text-slate-400">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : userResults.users.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400">No users found.</p>
                  ) : (
                    userResults.users.map((u) => (
                      <label key={u.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={selectedUsers.has(u.id)}
                          onChange={() => toggleUser(u.id)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-700">{u.fullName || u.email}</span>
                        <span className="truncate text-xs text-slate-400">{u.email}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="mt-2 text-xs font-semibold text-slate-500">{selectedUsers.size} selected</p>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl bg-slate-50 px-4 py-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={schedule} onChange={(e) => setSchedule(e.target.checked)} className="h-4 w-4 accent-primary" />
              Schedule for later
            </label>
            {schedule && (
              <input
                type="datetime-local"
                value={scheduleAt}
                min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="input sm:max-w-xs"
              />
            )}
            <span className="ml-auto inline-flex items-center gap-1.5 text-sm font-bold text-primary">
              <Users className="h-4 w-4" /> {recipientEstimate.toLocaleString()} recipient{recipientEstimate === 1 ? '' : 's'}
            </span>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={submitClicked}
              disabled={!formValid}
              className="btn-primary px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Send className="h-4 w-4" />
              {schedule ? 'Schedule notification' : 'Send notification'}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-card">
        <h3 className="font-display text-lg font-bold text-slate-900">Sent history</h3>

        {!history ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : history.notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
            <Bell className="h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-500">No notifications sent yet</p>
            <p className="text-sm text-slate-400">Use "Send Notification" to message your members.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Title / Message</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Recipients</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Sent / Scheduled</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.notifications.map((n) => (
                  <tr key={n.id} className="border-b border-slate-50 align-top transition hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{n.title}</p>
                      <p className="mt-0.5 line-clamp-2 max-w-xs whitespace-pre-wrap text-xs text-slate-500">{n.body}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${CATEGORY_BADGE[n.category] ?? 'bg-slate-100 text-slate-600'}`}>
                        {CATEGORIES.find((c) => c.key === n.category)?.label ?? n.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-700">{n.recipientCount.toLocaleString()}</p>
                      <p className="text-xs text-slate-400">
                        {n.status === 'sent' ? `${n.deliveredCount} delivered` : n.recipientType === 'all' ? 'All users' : n.recipientType === 'role' ? `Role: ${n.recipientRole}` : 'Selected users'}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[n.status] ?? 'bg-slate-100 text-slate-500'}`}>
                        {n.status === 'sent' && <CheckCircle2 className="h-3 w-3" />}
                        {n.status === 'scheduled' && <Clock className="h-3 w-3" />}
                        {n.status === 'failed' && <XCircle className="h-3 w-3" />}
                        {n.status === 'cancelled' && <AlertTriangle className="h-3 w-3" />}
                        {n.status.charAt(0).toUpperCase() + n.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {n.status === 'scheduled' ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                          <CalendarClock className="h-3.5 w-3.5" /> {formatDateTime(n.scheduledAt)}
                        </span>
                      ) : n.sentAt ? (
                        formatDateTime(n.sentAt)
                      ) : (
                        formatDateTime(n.createdAt)
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {n.status === 'scheduled' && (
                        <button onClick={() => handleCancelScheduled(n.id)} className="text-xs font-bold text-red-500 hover:underline">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {history && totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-sm">
            <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition enabled:hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition enabled:hover:bg-slate-50 disabled:opacity-40"
              >
                Next <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          count={confirm.count}
          title={confirm.title}
          scheduleAt={confirm.scheduleAt}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={handleSend}
        />
      )}
    </div>
  );
}