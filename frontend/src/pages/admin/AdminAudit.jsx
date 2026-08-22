import { useEffect, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';

const PAGE_SIZE = 20;

const ACTION_LABELS = {
  ADMIN_USER_SUSPENDED: 'User suspended',
  ADMIN_USER_REACTIVATED: 'User reactivated',
  ADMIN_USER_VIEWED: 'User account viewed',
  ADMIN_WALLET_ADJUSTMENT: 'Wallet adjustment',
  ADMIN_EXPENSE_RECORDED: 'Expense recorded',
  CONTRIBUTION_PLAN_CHANGED: 'Contribution plan changed',
};

export default function AdminAudit() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    let active = true;
    setData(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (action) params.set('action', action);
    api(`/admin/audit-logs?${params.toString()}`)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err.message ?? 'Could not load audit logs'));
    return () => {
      active = false;
    };
  }, [page, action]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
          Admin activity log <span className="text-sm font-semibold text-slate-500">({data?.total ?? '…'})</span>
        </h2>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="input max-w-xs">
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

      {!data && !error && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-card">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-primary-dark to-primary text-xs uppercase tracking-wider text-white">
                <th className="px-4 py-4 font-bold">Action</th>
                <th className="px-4 py-4 font-bold">Admin</th>
                <th className="px-4 py-4 font-bold">Target user</th>
                <th className="px-4 py-4 font-bold">Reason / details</th>
                <th className="px-4 py-4 font-bold">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 last:border-0 transition-colors hover:bg-blue-50/50">
                  <td className="px-4 py-3.5">
                    <span className="font-bold capitalize text-slate-800">
                      {ACTION_LABELS[log.action] ?? log.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">
                    {log.admin ? (
                      <div>
                        <p className="font-bold text-slate-700">{log.admin.fullName}</p>
                        <p className="mt-0.5 text-xs font-medium text-slate-500">{log.admin.email}</p>
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-slate-500">System / user</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">
                    {log.target ? (
                      <div>
                        <p className="font-bold text-slate-700">{log.target.fullName}</p>
                        <p className="mt-0.5 text-xs font-medium text-slate-500">{log.target.email}</p>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-xs font-medium text-slate-600">
                    {log.reason ?? (log.metadata ? JSON.stringify(log.metadata).slice(0, 80) : '—')}
                  </td>
                  <td className="px-4 py-3.5 text-xs font-medium text-slate-600">{formatDateTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm font-medium text-slate-500">
            Page {data.page} of {totalPages} · {data.total} entries
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-600 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
