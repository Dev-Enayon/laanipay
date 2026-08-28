import { useCallback, useEffect, useState } from 'react';
import {
  Receipt,
  Loader2,
  Calendar,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { naira, formatDateTime } from '../../lib/format.js';

function monthLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
}

function statusChip(status) {
  if (status === 'collected') {
    return { label: 'Deducted from wallet', cls: 'bg-emerald-50 text-emerald-700' };
  }
  if (status === 'pending') {
    return { label: 'Pending', cls: 'bg-amber-50 text-amber-700' };
  }
  return { label: 'Failed', cls: 'bg-red-50 text-red-700' };
}

const PAYSTACK_MAP = {
  internal: { label: 'Internal (no Paystack transfer)', cls: 'bg-slate-100 text-slate-600' },
  success: { label: 'Processed via Paystack', cls: 'bg-emerald-50 text-emerald-700' },
  pending: { label: 'Pending Paystack', cls: 'bg-amber-50 text-amber-700' },
  failed: { label: 'Failed Paystack', cls: 'bg-red-50 text-red-700' },
};

export default function AdminServiceCharge() {
  const [stats, setStats] = useState(null);
  const [month, setMonth] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Transactions panel
  const [open, setOpen] = useState(false);
  const [txnMonth, setTxnMonth] = useState('');
  const [transactions, setTransactions] = useState(null);

  const load = useCallback((m) => {
    setLoading(true);
    setError('');
    api(`/admin/service-charges?month=${encodeURIComponent(m || '')}`)
      .then((d) => {
        setStats(d);
        setMonth((cur) => (m && m !== '' ? m : d.month || cur));
      })
      .catch((err) => setError(err.message ?? 'Could not load service charge statistics'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load('');
  }, [load]);

  const allMonths = stats?.history?.map((h) => h.month) ?? [];
  const defaultMonth = stats?.month;
  const months = allMonths.includes(defaultMonth) ? allMonths : [defaultMonth, ...allMonths].filter(Boolean);

  const openTransactions = (m) => {
    setOpen(true);
    setTxnMonth(m);
    setTransactions(null);
    api(`/admin/service-charges/transactions?month=${encodeURIComponent(m)}&page=1&pageSize=50`)
      .then(setTransactions)
      .catch((err) => setTransactions({ error: err.message ?? 'Could not load transactions' }));
  };

  const fetchPage = (page) => {
    setTransactions(null);
    api(`/admin/service-charges/transactions?month=${encodeURIComponent(txnMonth)}&page=${page}&pageSize=50`)
      .then(setTransactions)
      .catch((err) => setTransactions({ error: err.message ?? 'Could not load transactions' }));
  };

  const handleRunNow = () => {
    if (!window.confirm('Run the monthly service charge collection now? This is idempotent and will not double-charge any user.')) {
      return;
    }
    api('/service-charges/admin/run', { method: 'POST', body: { billingMonth: month || undefined } })
      .then((r) => {
        const ran = r.month || month || stats?.month;
        const details = Object.entries(r)
          .filter(([k, v]) => typeof v === 'number')
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        window.alert(`Collection complete for ${monthLabel(ran)}.\n${details}`);
        load(month || stats?.month);
      })
      .catch((err) => window.alert(err.message ?? 'Run failed'));
  };

  const s = stats?.summary;

  const summaryCards = [
    { label: 'Total Collected This Month', value: naira(s?.totalCollected ?? 0), icon: Receipt, chip: 'from-emerald-500 to-emerald-700', hint: s ? `${s.usersCharged} users x fee records` : '' },
    { label: 'Users Charged', value: s?.usersCharged ?? 0, icon: CheckCircle2, chip: 'from-blue-500 to-blue-700', hint: 'Successfully deducted' },
    { label: 'Pending', value: s?.pending ?? 0, icon: Clock, chip: 'from-amber-500 to-amber-700', hint: 'Not yet finalized' },
    { label: 'Failed', value: s?.failed ?? 0, icon: XCircle, chip: 'from-red-500 to-red-700', hint: `Incl. ${s?.insufficient ?? 0} insufficient funds` },
    { label: 'Not Yet Charged', value: s?.notCharged ?? 0, icon: AlertTriangle, chip: 'from-slate-500 to-slate-700', hint: `${stats?.eligible ?? 0} eligible users` },
  ];

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
            <Receipt className="h-5 w-5 text-primary" /> Monthly Service Charge
          </h3>
          <p className="mt-0.5 text-xs font-medium text-slate-500">
            {stats?.monthlyFeeKobo ? `₦${naira(stats.monthlyFeeKobo).replace('₦', '')} per eligible user per month` : ''}
            . Totals computed from transaction records, never `users × fee`.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
            <Calendar className="h-4 w-4 text-slate-400" />
            <select
              value={month}
              onChange={(e) => {
                const m = e.target.value;
                setMonth(m);
                load(m);
              }}
              className="bg-transparent text-sm font-semibold text-slate-700 outline-none"
            >
              {months.length === 0 && <option value="">Select month</option>}
              {months.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={handleRunNow}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-white shadow-glow transition hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Run now
          </button>
        </div>
      </div>

      {error && <div className="mx-5 mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

      {loading && !stats ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-5">
            {summaryCards.map((card) => (
              <button
                key={card.label}
                onClick={card.label === 'Total Collected This Month' ? () => openTransactions(month || defaultMonth) : undefined}
                className={`rounded-2xl border border-slate-100 bg-white p-4 text-left transition-all duration-200 ${
                  card.label === 'Total Collected This Month'
                    ? 'cursor-pointer hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow'
                    : 'cursor-default'
                }`}
              >
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${card.chip}`}>
                  <card.icon className="h-5 w-5 text-white" />
                </div>
                <p className="mt-3 font-display text-xl font-bold tracking-tight text-slate-900">
                  {card.label === 'Total Collected This Month' ? naira(s?.totalCollected ?? 0) : card.value}
                </p>
                <p className="mt-0.5 text-xs font-semibold leading-snug text-slate-500">{card.label}</p>
                {card.hint && (
                  <p className="mt-1 text-[10px] font-medium text-slate-400">{card.hint}</p>
                )}
                {card.label === 'Total Collected This Month' && (
                  <p className="mt-1 text-[10px] font-semibold text-primary">View transactions →</p>
                )}
              </button>
            ))}
          </div>

          <div className="px-5 pb-5">
            <h4 className="mb-3 text-sm font-bold text-slate-900">Monthly breakdown</h4>
            {stats?.history?.length ? (
              <div className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-3">Month</th>
                      <th className="px-4 py-3">Users Charged</th>
                      <th className="px-4 py-3">Total Collected</th>
                      <th className="px-4 py-3">Failed</th>
                      <th className="px-4 py-3">Pending</th>
                      <th className="px-4 py-3 text-right">Transactions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.history.map((h) => (
                      <tr key={h.month} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                        <td className="px-4 py-3 font-semibold text-slate-800">{monthLabel(h.month)}</td>
                        <td className="px-4 py-3 text-slate-600">{h.usersCharged}</td>
                        <td className="px-4 py-3 font-semibold text-emerald-700">{naira(h.totalCollected)}</td>
                        <td className="px-4 py-3 text-red-600">{h.failed}</td>
                        <td className="px-4 py-3 text-amber-600">{h.pending}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => openTransactions(h.month)}
                            className="text-xs font-bold text-primary hover:underline"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
                No service charges recorded yet.
              </p>
            )}
          </div>
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
                  <Receipt className="h-5 w-5 text-primary" /> Service charge transactions
                </h3>
                <p className="text-xs font-medium text-slate-500">{monthLabel(txnMonth)}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(85vh-10rem)] overflow-auto">
              {!transactions ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
              ) : transactions.error || transactions.transactions === undefined ? (
                <div className="px-5 py-6 text-sm font-bold text-red-700">
                  {transactions.error ?? 'Could not load transactions'}
                </div>
              ) : transactions.transactions.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-400">No transactions for {monthLabel(txnMonth)}.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="sticky top-0">
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                        <th className="px-4 py-3">User</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3">Wallet Ref</th>
                        <th className="px-4 py-3">Paystack</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Failure reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.transactions.map((t) => {
                        const st = statusChip(t.status);
                        const ps = PAYSTACK_MAP[t.paystackStatus] ?? {
                          label: t.paystackReference ? `Ref: ${t.paystackReference}` : '—',
                          cls: 'bg-slate-100 text-slate-600',
                        };
                        return (
                          <tr key={t.id} className="border-b border-slate-50 align-top transition hover:bg-slate-50/60">
                            <td className="px-4 py-3">
                              <p className="font-semibold text-slate-800">{t.user ?? '—'}</p>
                              <p className="text-xs text-slate-400">{t.email}</p>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">
                              {naira(t.amountKobo)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDateTime(t.collectedAt)}</td>
                            <td className="px-4 py-3">
                              <p className="font-mono text-xs text-slate-600">{t.walletReference ?? t.walletTransactionId ?? '—'}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${ps.cls}`}>
                                {ps.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                                {st.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-slate-500">{t.failureReason ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {transactions && transactions.transactions && (
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm">
                <span className="text-xs text-slate-500">
                  {transactions.total} transactions · page {transactions.page}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    disabled={transactions.page <= 1}
                    onClick={() => fetchPage(transactions.page - 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition enabled:hover:bg-slate-50 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Prev
                  </button>
                  <button
                    disabled={transactions.page * transactions.pageSize >= transactions.total}
                    onClick={() => fetchPage(transactions.page + 1)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition enabled:hover:bg-slate-50 disabled:opacity-40"
                  >
                    Next <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
