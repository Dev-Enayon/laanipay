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
        <h2 className="text-lg font-bold text-slate-900">
          Admin activity log <span className="text-sm font-medium text-slate-400">({data?.total ?? '…'})</span>
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

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>}

      {!data && !error && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100 bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Target user</th>
                <th className="px-4 py-3">Reason / details</th>
                <th className="px-4 py-3">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {data.logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <span className="font-semibold capitalize text-slate-800">
                      {ACTION_LABELS[log.action] ?? log.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {log.admin ? (
                      <div>
                        <p className="font-medium text-slate-700">{log.admin.fullName}</p>
                        <p className="text-xs text-slate-400">{log.admin.email}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">System / user</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {log.target ? (
                      <div>
                        <p className="font-medium text-slate-700">{log.target.fullName}</p>
                        <p className="text-xs text-slate-400">{log.target.email}</p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {log.reason ?? (log.metadata ? JSON.stringify(log.metadata).slice(0, 80) : '—')}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{formatDateTime(log.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Page {data.page} of {totalPages} · {data.total} entries
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
