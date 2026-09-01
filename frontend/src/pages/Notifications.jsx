import { useEffect, useState, useCallback } from 'react';
import { Bell, CheckCheck, Check, X, Loader2, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';

const PAGE_SIZE = 15;

const CATEGORY_STYLES = {
  announcement: { label: 'Announcement', cls: 'bg-blue-50 text-blue-700' },
  system: { label: 'System', cls: 'bg-slate-100 text-slate-600' },
  reminder: { label: 'Reminder', cls: 'bg-amber-50 text-amber-700' },
  promotion: { label: 'Promotion', cls: 'bg-violet-50 text-violet-700' },
  alert: { label: 'Alert', cls: 'bg-red-50 text-red-700' },
};

function notifyUpdated() {
  window.dispatchEvent(new CustomEvent('laani:notifications-updated'));
}

export default function Notifications() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback((p) => {
    setError('');
    setData(null);
    api(`/notifications?page=${p}&pageSize=${PAGE_SIZE}`)
      .then(setData)
      .catch((err) => setError(err.message ?? 'Could not load notifications'));
  }, []);

  useEffect(() => {
    load(page);
  }, [page, load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const handleRead = async (id) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await api(`/notifications/${id}/read`, { method: 'POST' });
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
      }));
      notifyUpdated();
    } catch (err) {
      window.alert(err.message ?? 'Failed to mark as read');
    } finally {
      setBusyId(null);
    }
  };

  const handleReadAll = async () => {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      setData((prev) => ({
        ...prev,
        notifications: prev.notifications.map((n) => ({ ...n, read: true })),
      }));
      notifyUpdated();
    } catch (err) {
      window.alert(err.message ?? 'Failed to mark as read');
    }
  };

  const handleDismiss = async (id) => {
    try {
      await api(`/notifications/${id}`, { method: 'DELETE' });
      setData((prev) => ({
        ...prev,
        total: Math.max(0, prev.total - 1),
        notifications: prev.notifications.filter((n) => n.id !== id),
      }));
      notifyUpdated();
    } catch (err) {
      window.alert(err.message ?? 'Failed to dismiss');
    }
  };

  const unreadCount = data?.notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <div className="container-lp pt-28 pb-16">
      <div className="card-light overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div>
            <h1 className="flex items-center gap-2 font-display text-xl font-bold text-slate-900">
              <Bell className="h-5 w-5 text-primary" /> Notifications
              {unreadCount > 0 && (
                <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{unreadCount} unread</span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {data?.total ?? '…'} total notification{data?.total === 1 ? '' : 's'}
            </p>
          </div>
          {unreadCount > 0 && (
            <button onClick={handleReadAll} className="btn-primary px-4 py-2 text-sm">
              <CheckCheck className="h-4 w-4" /> Mark all as read
            </button>
          )}
        </div>

        {error && <div className="m-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

        {!data && !error ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : data?.notifications?.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <Inbox className="h-10 w-10 text-slate-300" />
            <p className="font-semibold text-slate-500">You're all caught up</p>
            <p className="text-sm text-slate-400">New notifications from LaaniPay will appear here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.notifications.map((n) => {
              const cat = CATEGORY_STYLES[n.category] ?? CATEGORY_STYLES.system;
              return (
                <li
                  key={n.id}
                  className={`flex gap-4 px-6 py-4 transition ${n.read ? 'bg-white' : 'bg-primary/[0.03]'}`}
                >
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${n.read ? 'bg-slate-200' : 'bg-primary'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {n.category && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cat.cls}`}>{cat.label}</span>
                      )}
                      <p className={`font-semibold ${n.read ? 'text-slate-600' : 'text-slate-900'}`}>{n.title}</p>
                      {n.senderName && <span className="text-xs text-slate-400">from {n.senderName}</span>}
                    </div>
                    <p className={`mt-1 whitespace-pre-wrap text-sm ${n.read ? 'text-slate-500' : 'text-slate-700'}`}>
                      {n.body}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-400">{formatDateTime(n.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1">
                    {!n.read && (
                      <button
                        onClick={() => handleRead(n.id)}
                        disabled={busyId === n.id}
                        title="Mark as read"
                        className="rounded-lg p-2 text-slate-400 transition hover:bg-primary/10 hover:text-primary"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDismiss(n.id)}
                      title="Dismiss"
                      className="rounded-lg p-2 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3 text-sm">
            <span className="text-xs text-slate-500">
              Page {page} of {totalPages}
            </span>
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
    </div>
  );
}