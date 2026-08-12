import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { naira, formatDate } from '../../lib/format.js';
import { StatusBadge } from './badges.jsx';

const PAGE_SIZE = 15;

const SORTS = [
  { key: 'created_at', label: 'Registration date' },
  { key: 'wallet_balance', label: 'Wallet balance' },
  { key: 'total_contributed', label: 'Total contribution' },
];

export default function AdminUsers() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [planId, setPlanId] = useState('');
  const [level, setLevel] = useState('');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [plans, setPlans] = useState([]);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    api('/contributions/plans')
      .then((d) => setPlans(d.plans))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setData(null);
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort, order });
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (planId) params.set('planId', planId);
    if (level) params.set('level', level);

    api(`/admin/users?${params.toString()}`)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err.message ?? 'Could not load users'));
    return () => {
      active = false;
    };
  }, [debouncedSearch, status, planId, level, sort, order, page]);

  const changeSort = (key) => {
    if (sort === key) {
      setOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSort(key);
      setOrder('desc');
    }
    setPage(1);
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">
          Users <span className="text-sm font-medium text-slate-400">({data?.total ?? '…'})</span>
        </h2>
      </div>

      <div className="card-light mt-4 p-4">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email or phone..."
              className="input pl-9"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <select value={planId} onChange={(e) => { setPlanId(e.target.value); setPage(1); }} className="input">
            <option value="">All plans</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({naira(p.monthlyAmount)})
              </option>
            ))}
          </select>
          <select value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }} className="input">
            <option value="">All MLM levels</option>
            {[1, 2, 3, 4, 5, 6, 7].map((l) => (
              <option key={l} value={l}>
                Level {l}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => changeSort(s.key)}
              className={`rounded-lg border px-3 py-1.5 font-semibold transition-colors ${
                sort === s.key ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {s.label} {sort === s.key ? (order === 'desc' ? '↓' : '↑') : ''}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>}

      {!data && !error && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {data && (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-100 bg-white">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Wallet</th>
                <th className="px-4 py-3">MLM</th>
                <th className="px-4 py-3">Contributed</th>
                <th className="px-4 py-3">Withdrawn</th>
                <th className="px-4 py-3">Registered</th>
                <th className="px-4 py-3">Last activity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{u.fullName}</p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                    <p className="text-xs text-slate-400">{u.phone}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={u.status} />
                      <span className="text-[10px] text-slate-400">
                        {u.activationStatus ? 'Activated' : 'Not activated'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {u.plan ? (
                      <div>
                        <p className="font-medium text-slate-700">{u.plan.name}</p>
                        <p className="text-xs text-slate-400">{naira(u.plan.monthlyAmount)}/mo</p>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{naira(u.walletBalance)}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700">Lvl {u.mlmLevel}</p>
                    <p className="text-xs text-slate-400">{u.directReferrals} direct · {u.totalDownline} downline</p>
                  </td>
                  <td className="px-4 py-3 font-semibold text-emerald-600">{naira(u.totalContributed)}</td>
                  <td className="px-4 py-3 text-slate-700">{naira(u.totalWithdrawn)}</td>
                  <td className="px-4 py-3 text-slate-600">{formatDate(u.createdAt)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{u.lastActivityAt ? formatDate(u.lastActivityAt) : '—'}</td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/users/${u.id}`} className="text-xs font-semibold text-primary hover:underline">
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Page {data.page} of {totalPages} · {data.total} users
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
