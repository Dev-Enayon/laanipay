import { useEffect, useState } from 'react';
import { Coins, Loader2, Users2, BadgeCheck, Gift, Wallet, Crown } from 'lucide-react';
import { api } from '../../lib/api.js';
import { naira, formatDateTime } from '../../lib/format.js';

const TYPE_LABELS = {
  REGISTRATION: { label: 'Registration', cls: 'bg-sky-50 text-sky-700' },
  MONTHLY_SUBSCRIPTION: { label: 'Monthly subscription', cls: 'bg-amber-50 text-amber-700' },
};

const ROUND_REWARDS = (ladder) => {
  if (!ladder || typeof ladder !== 'object') return {};
  const out = {};
  for (const level of [1, 2, 3]) {
    const k = level.toString();
    if (ladder[k] !== undefined) out[k] = ladder[k];
  }
  return out;
};

export default function AdminRewards() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/admin/rewards')
      .then(setData)
      .catch((err) => setError(err.message ?? 'Could not load rewards'));
  }, []);

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

  const reg = ROUND_REWARDS(data.ladder?.REGISTRATION);
  const sub = ROUND_REWARDS(data.ladder?.MONTHLY_SUBSCRIPTION);
  const byType =
    data.byType?.map((row) => ({
      ...row,
      label:
        TYPE_LABELS[row.type]?.label ??
        row.type,
    })) ?? [];

  return (
    <div>
      <div>
        <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">Referral rewards ledger</h2>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Every bonus is recorded as an immutable ledger row — nothing is computed on the fly.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700">
            <Wallet className="h-5 w-5 text-white" />
          </div>
          <p className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900">{naira(data.summary.total)}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Total rewards paid</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600">
            <BadgeCheck className="h-5 w-5 text-white" />
          </div>
          <p className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900">{data.summary.count}</p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Ledger entries</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-sky-600">
            <Users2 className="h-5 w-5 text-white" />
          </div>
          <p className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900">
            {byType.reduce((sum, row) => sum + row._count._all, 0)}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Bonus payments</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-400 to-fuchsia-600">
            <Coins className="h-5 w-5 text-white" />
          </div>
          <p className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900">
            {byType.filter((row) => row.type === 'MONTHLY_SUBSCRIPTION').length > 0 ? 'Recurring' : '—'}
          </p>
          <p className="mt-1 text-xs font-semibold text-slate-500">Subscription rewards active</p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Gift className="h-4 w-4 text-primary" /> Registration rewards (per activation)
          </h3>
          <div className="mt-3 space-y-2">
            {[1, 2, 3].map((level, index) => (
              <div
                key={level}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-100 text-sm font-bold text-sky-700">
                    L{level}
                  </span>
                  <span className="text-sm font-medium text-slate-600">
                    Level {level} · {index === 0 ? 'direct' : `${index} upline above`}
                  </span>
                </div>
                <span className="font-display text-lg font-bold text-slate-900">
                  ₦{((reg[String(level)] ?? 0) / 100).toLocaleString()}
                </span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-slate-400">
              Paid once when each downline activates. Never exceeds the activation fee.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <Crown className="h-4 w-4 text-primary" /> Monthly subscription rewards (₦300/month)
          </h3>
          <div className="mt-3 space-y-2">
            {[1, 2, 3].map((level, index) => (
              <div
                key={level}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-sm font-bold text-amber-700">
                    L{level}
                  </span>
                  <span className="text-sm font-medium text-slate-600">
                    Level {level} · {index === 0 ? 'direct' : `${index} upline above`}
                  </span>
                </div>
                <span className="font-display text-lg font-bold text-slate-900">
                  ₦{((sub[String(level)] ?? 0) / 100).toLocaleString()}
                </span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-slate-400">
              Paid monthly on every active downline subscription. Never exceeds the monthly fee.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
        <h3 className="mb-3 text-sm font-bold text-slate-900">Paid out by type</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {byType.length === 0 && <p className="text-sm text-slate-400">No rewards recorded yet.</p>}
          {byType.map((row) => {
            const label = TYPE_LABELS[row.type] ?? { label: row.type, cls: 'bg-slate-100 text-slate-600' };
            return (
              <div key={`${row.type}-${row.level}`} className="rounded-xl border border-slate-100 px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${label.cls}`}>
                    {label.label} · L{row.level}
                  </span>
                  <span className="font-display text-base font-bold text-slate-900">{naira(row._sum.amountKobo ?? 0)}</span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">{row._count._all} entries</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
        <h3 className="mb-3 text-sm font-bold text-slate-900">Recent ledger entries</h3>
        {data.recent.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            No rewards distributed yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Level</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => {
                  const label = TYPE_LABELS[r.type] ?? { label: r.type, cls: 'bg-slate-100 text-slate-600' };
                  return (
                    <tr key={r.id} className="border-b border-slate-50 transition hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-800">{r.recipient?.fullName ?? '—'}</p>
                        <p className="text-xs text-slate-400">{r.recipient?.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-slate-700">{r.source?.fullName ?? '—'}</p>
                        <p className="text-xs text-slate-400">{r.source?.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${label.cls}`}>{label.label}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">Level {r.level}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-emerald-700">{naira(r.amountKobo)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatDateTime(r.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}