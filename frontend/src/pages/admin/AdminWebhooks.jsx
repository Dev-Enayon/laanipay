import { useEffect, useState } from 'react';
import { Webhook, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';

const STATUS_LABELS = {
  PROCESSED: { label: 'Processed', cls: 'bg-emerald-50 text-emerald-700' },
  FAILED: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
  IGNORED: { label: 'Ignored', cls: 'bg-slate-100 text-slate-600' },
};

export default function AdminWebhooks() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setError('');
    setData(null);
    api(`/admin/webhooks?page=${page}&pageSize=25`)
      .then(setData)
      .catch((err) => setError(err.message ?? 'Could not load webhook events'));
  }, [page]);

  if (error) {
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>;
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-slate-900">
          <Webhook className="h-5 w-5 text-primary" /> Webhook events
        </h2>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Every Paystack event is stored for idempotency and audit. A settled reference is only ever processed once.
        </p>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
        {data.events.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">No webhook events received yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3">Provider</th>
                  <th className="px-5 py-3">Event</th>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Message</th>
                  <th className="px-5 py-3">Received</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => {
                  const st = STATUS_LABELS[e.status] ?? { label: e.status, cls: 'bg-slate-100 text-slate-600' };
                  return (
                    <tr key={e.id} className="border-b border-slate-50 align-top transition hover:bg-slate-50/60">
                      <td className="px-5 py-3 font-semibold text-slate-800">{e.provider}</td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">{e.event}</td>
                      <td className="px-5 py-3">
                        <p className="max-w-[220px] truncate font-mono text-xs text-slate-600">{e.reference ?? '—'}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                      </td>
                      <td className="max-w-[260px] px-5 py-3 text-xs text-slate-500">{e.message ?? '—'}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDateTime(e.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
          <span className="text-xs text-slate-500">{data.total} events · page {data.page}</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition enabled:hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </button>
            <button
              disabled={page * data.pageSize >= data.total}
              onClick={() => setPage(page + 1)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition enabled:hover:bg-slate-50 disabled:opacity-40"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}