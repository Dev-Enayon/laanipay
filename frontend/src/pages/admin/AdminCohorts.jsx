import { useCallback, useEffect, useState } from 'react';
import {
  Layers,
  Loader2,
  Users,
  Coins,
  RefreshCw,
  ChevronRight,
  X,
  CalendarClock,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { naira, formatDate, formatDateTime } from '../../lib/format.js';

const STATUS_LABELS = {
  RECRUITING: { label: 'Recruiting', cls: 'bg-sky-50 text-sky-700' },
  ACTIVE: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700' },
  COMPLETED: { label: 'Completed', cls: 'bg-slate-100 text-slate-600' },
};

const MEMBER_STATUS_LABELS = {
  REQUIRES_REPAYMENT: { label: 'Owes', cls: 'bg-red-50 text-red-700' },
  SKIPPED: { label: 'Missed week', cls: 'bg-amber-50 text-amber-700' },
  ACTIVE: { label: 'Active', cls: 'bg-emerald-50 text-emerald-700' },
};

const PAYOUT_STATUS_LABELS = {
  PENDING: { label: 'Pending', cls: 'bg-amber-50 text-amber-700' },
  PAID: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
  FAILED: { label: 'Failed', cls: 'bg-red-50 text-red-700' },
};

export default function AdminCohorts() {
  const [cohorts, setCohorts] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [detail, setDetail] = useState(null); // {id, data, loading, actionError}
  const [detailBusy, setDetailBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    api('/admin/cohorts')
      .then(setCohorts)
      .catch((err) => setError(err.message ?? 'Could not load cohorts'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = (id) => {
    setDetail({ id, data: null, loading: true, actionError: '' });
    api(`/admin/cohorts/${id}`)
      .then((d) => setDetail({ id, data: d.cohort, loading: false, actionError: '' }))
      .catch((err) =>
        setDetail({ id, data: null, loading: false, actionError: err.message ?? 'Could not load cohort' }),
      );
  };

  const advanceWeek = async (id) => {
    if (!window.confirm('Advance the current week of this cohort? Payouts are credited and the week counter moves. This is idempotent and cannot be reversed.')) {
      return;
    }
    setBusy(true);
    setDetail((d) => (d && d.id === id ? { ...d, actionError: '' } : d));
    try {
      const res = await api(`/admin/cohorts/${id}/advance-week`, { method: 'POST', body: { confirm: true } });
      window.alert(`Week advanced to ${res.result?.currentWeek ?? 'next week'}. Payouts credited: ${res.result?.payoutsCredited ?? 0}.`);
      load();
      openDetail(id);
    } catch (err) {
      setDetail((d) => (d && d.id === id ? { ...d, actionError: err.message ?? 'Failed' } : d));
    } finally {
      setBusy(false);
    }
  };

  const advanceAll = async () => {
    if (!window.confirm('Advance every active cohort one week right now? This is idempotent — cohorts already processed for their due week will be skipped.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await api('/admin/cohorts/advance-all', { method: 'POST', body: { confirm: true } });
      window.alert(`Cohorts advanced: ${res.results?.processed ?? 0}, skipped: ${res.results?.skipped ?? 0}.`);
      load();
      if (detail) openDetail(detail.id);
    } catch (err) {
      window.alert(err.message ?? 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const totalPot = (c) => c.memberCount * c.weeklyAmount;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">Weekly AJO cohorts</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            52-week rotating savings pools. Weekly payouts are credited automatically every Monday at 04:00 or when a week is advanced.
          </p>
        </div>
        <button
          onClick={advanceAll}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-glow transition enabled:hover:opacity-90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /> Advance all cohorts
        </button>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

      {!cohorts && !error && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {cohorts && cohorts.cohorts.length === 0 && (
        <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-10 text-center text-sm text-slate-500">
          No cohorts yet. They are created automatically when members join a weekly plan.
        </div>
      )}

      {cohorts && cohorts.cohorts.length > 0 && (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cohorts.cohorts.map((c) => {
            const st = STATUS_LABELS[c.status] ?? { label: c.status, cls: 'bg-slate-100 text-slate-600' };
            const fill = c.memberCount / c.size;
            return (
              <button
                key={c.id}
                onClick={() => openDetail(c.id)}
                className="group rounded-2xl border border-slate-100 bg-white p-5 text-left shadow-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-glow"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-900">{c.name}</p>
                    <p className="mt-0.5 text-xs font-medium text-slate-400">
                      {c.planName} · Week {c.currentWeek}/{c.periodWeeks}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-lg font-bold text-slate-900">{c.memberCount}/{c.size}</p>
                      <p className="text-[11px] text-slate-400">Members</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-primary" />
                    <div>
                      <p className="text-lg font-bold text-slate-900">{naira(c.weeklyAmount)}</p>
                      <p className="text-[11px] text-slate-400">Per week</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-neon"
                    style={{ width: `${(fill > 1 ? 1 : fill) * 100}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-slate-400">
                  <span>Weekly pot: {naira(totalPot(c))}</span>
                  <span>{c.paidPayouts} of {c.currentWeek - 1} payouts paid</span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs font-bold text-primary opacity-0 transition group-hover:opacity-100">
                  View cohort <ChevronRight className="h-3.5 w-3.5" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">{detail.data?.name ?? 'Cohort'}</h3>
                <p className="text-xs font-medium text-slate-500">
                  {detail.data ? (
                    <>
                      {detail.data.plan.name} · {naira(detail.data.plan.weeklyAmount)}/week · {detail.data.size} members · started{' '}
                      {formatDate(detail.data.startedAt)}
                    </>
                  ) : (
                    'Loading…'
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {detail.data && (
                  <button
                    onClick={() => advanceWeek(detail.data.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white shadow-glow transition enabled:hover:opacity-90 disabled:opacity-50"
                  >
                    <CalendarClock className="h-3.5 w-3.5" /> Advance week {detail.data.currentWeek}
                  </button>
                )}
                <button
                  onClick={() => setDetail(null)}
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="max-h-[calc(88vh-8rem)] overflow-auto">
              {detail.loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-7 w-7 animate-spin text-primary" />
                </div>
              ) : detail.actionError ? (
                <div className="px-5 py-6 text-sm font-bold text-red-700">{detail.actionError}</div>
              ) : detail.data ? (
                <div className="space-y-6 p-5">
                  {detail.data.payouts.length > 0 && (
                    <div className="rounded-2xl border border-slate-100 p-4">
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                        <TrendingUp className="h-4 w-4 text-primary" /> Payouts ({detail.data.payouts.length}/{detail.data.plan.cycleWeeks})
                      </h4>
                      <div className="overflow-x-auto rounded-xl border border-slate-100">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <thead>
                            <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                              <th className="px-4 py-3">Week</th>
                              <th className="px-4 py-3">Member</th>
                              <th className="px-4 py-3">Gross</th>
                              <th className="px-4 py-3">Fee</th>
                              <th className="px-4 py-3">Net paid</th>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3">Processed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {detail.data.payouts.map((p) => {
                              const ps = PAYOUT_STATUS_LABELS[p.status] ?? { label: p.status, cls: 'bg-slate-100 text-slate-600' };
                              const member = detail.data.members.find((m) => m.userId === p.userId);
                              return (
                                <tr key={p.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                                  <td className="px-4 py-3 font-semibold text-slate-800">Week {p.weekIndex + 1}</td>
                                  <td className="px-4 py-3">
                                    <p className="font-semibold text-slate-800">{member?.fullName ?? '—'}</p>
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{naira(p.grossAmount)}</td>
                                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{naira(p.platformFee)}</td>
                                  <td className="whitespace-nowrap px-4 py-3 font-semibold text-emerald-700">{naira(p.netAmount)}</td>
                                  <td className="px-4 py-3">
                                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ps.cls}`}>{ps.label}</span>
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                                    {p.processedAt ? formatDateTime(p.processedAt) : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-100 p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                      <Users className="h-4 w-4 text-primary" /> Members ({detail.data.members.length})
                    </h4>
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                      <table className="w-full min-w-[760px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                            <th className="px-4 py-3">#</th>
                            <th className="px-4 py-3">Member</th>
                            <th className="px-4 py-3">Status</th>
                            <th className="px-4 py-3">Paid</th>
                            <th className="px-4 py-3">Last paid week</th>
                            <th className="px-4 py-3">Collected week</th>
                            <th className="px-4 py-3">Joined</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.data.members.map((m) => {
                            const ms =
                              MEMBER_STATUS_LABELS[m.status] ?? { label: m.status, cls: 'bg-slate-100 text-slate-600' };
                            return (
                              <tr key={m.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                                <td className="px-4 py-3 font-semibold text-slate-400">#{m.position + 1}</td>
                                <td className="px-4 py-3">
                                  <p className="font-semibold text-slate-800">{m.fullName}</p>
                                  <p className="text-xs text-slate-400">{m.email}</p>
                                </td>
                                <td className="px-4 py-3">
                                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ms.cls}`}>{ms.label}</span>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">{naira(m.totalPaid)}</td>
                                <td className="px-4 py-3 text-slate-600">
                                  {m.lastPaidWeek != null ? `Week ${m.lastPaidWeek + 1}` : '—'}
                                </td>
                                <td className="px-4 py-3 text-slate-600">
                                  {m.collectedWeek != null ? `Week ${m.collectedWeek + 1}` : '—'}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDateTime(m.joinedAt)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs font-medium text-amber-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Advance is idempotent: each week settles at most once. Members flagged{' '}
                    <span className="font-bold">Owes</span> must repay before collecting; they are skipped and repaid
                    on a later week.
                  </div>
                </div>
              ) : (
                <div className="px-5 py-6 text-sm font-bold text-red-700">{detail.actionError || 'Could not load cohort'}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}