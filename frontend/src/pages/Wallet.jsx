import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Wallet as WalletIcon,
  PiggyBank,
  TrendingUp,
  History,
  ArrowRight,
  Landmark,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { naira, formatDate } from '../lib/format.js';
import { frequencyLabel, periodSuffix, planAmount } from '../lib/plans.js';
import Reveal from '../components/Reveal.jsx';

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/wallet')
      .then(setWallet)
      .catch((err) => setError(err.message ?? 'Could not load wallet'));

    api('/contributions/overview')
      .then(setOverview)
      .catch(() => setOverview(null));
  }, []);

  const subscriptions = overview?.subscriptions ?? [];
  const allHistory = subscriptions
    .flatMap((s) => (s.history ?? []).map((h) => ({ ...h, plan: s.plan })))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const balance = wallet?.balance ?? 0;
  const heldBalance = wallet?.heldBalance ?? 0;

  return (
    <div className="container-lp pt-28 pb-16">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Wallet</span>
        <h1 className="section-title text-slate-900">Your LaaniPay wallet</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Track your referral earnings and everything you&apos;ve contributed to your savings.
        </p>
      </div>

      {error && (
        <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>
      )}

      {!wallet && !error && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {wallet && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Reveal>
              <div className="card-light relative overflow-hidden p-6 sm:p-8">
                <div className="hero-gradient absolute inset-0 opacity-10" />
                <div className="relative flex items-center gap-2 text-sm font-medium text-slate-500">
                  <PiggyBank className="h-4 w-4 shrink-0 text-primary" /> Total contributed
                </div>
                <p className="relative mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">
                  {naira(wallet.totalContributed ?? 0)}
                </p>
                <p className="relative mt-2 text-xs text-slate-400">
                  From verified contribution payments
                  {subscriptions.length > 0
                    ? ` · ${subscriptions
                        .map((s) => `${s.plan?.name} ${naira(s.amount ?? planAmount(s.plan))}${periodSuffix(s.plan?.frequency)}`)}
                        .join(' · ')}`
                    : ''}
                </p>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="card-light relative overflow-hidden p-6 sm:p-8">
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-neon/10 blur-3xl" />
                <div className="relative flex items-center gap-2 text-sm font-medium text-slate-500">
                  <TrendingUp className="h-4 w-4 shrink-0 text-primary" /> Referral earnings balance
                </div>
                <p className="relative mt-2 text-3xl font-extrabold text-slate-900 sm:text-4xl">
                  {naira(wallet.balance ?? 0)}
                </p>
                <p className="relative mt-2 text-xs text-slate-400">MLM bonuses credited to you</p>
              </div>
            </Reveal>
          </div>

          <div className="mt-6">
            <Reveal>
              <div className="card-light relative overflow-hidden p-6 sm:p-8">
                <div className="hero-gradient absolute inset-0 opacity-10" />
                <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Landmark className="h-5 w-5 text-primary" />
                      <h3 className="text-base font-bold text-slate-900">Withdraw funds</h3>
                    </div>
                    <p className="mt-3 text-xs uppercase tracking-wide text-slate-400">Available balance</p>
                    <p className="mt-1 text-3xl font-extrabold text-slate-900 sm:text-4xl">{naira(balance)}</p>
                    {heldBalance > 0 && (
                      <p className="mt-2 text-xs text-slate-400">
                        · {naira(heldBalance)} held in pending requests
                      </p>
                    )}
                    <p className="mt-2 text-xs text-slate-400">
                      Funds are reserved immediately and released only after admin verification.
                    </p>
                  </div>
                  <Link to="/withdraw" className="btn-primary shrink-0 sm:px-10">
                    Request withdrawal <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Reveal>
              <div className="card-light p-6">
                <div className="flex items-center gap-2">
                  <WalletIcon className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-bold text-slate-900">Savings progress</h3>
                </div>
                {subscriptions.length > 0 ? (
                  <>
                    <div className="mt-4 space-y-4">
                      {subscriptions.map((s) => {
                        const weekly = s.plan?.frequency === 'WEEKLY';
                        const pct = Math.round((s.progress ?? 0) * 100);
                        return (
                          <div key={s.id}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-semibold text-slate-800">{s.plan?.name}</span>
                              <span className="text-xs font-medium text-slate-500">
                                {frequencyLabel(s.plan?.frequency)} · {naira(s.amount ?? planAmount(s.plan))}
                                {periodSuffix(s.plan?.frequency)}
                              </span>
                            </div>
                            {weekly ? (
                              <>
                                <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-primary to-neon transition-all duration-700"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                                <div className="mt-1.5 flex items-center justify-between text-xs text-slate-400">
                                  <span>
                                    {s.weeksPaid ?? 0}/{s.cycleWeeks ?? 52} weeks
                                  </span>
                                  <span>{naira(s.totalContributed ?? 0)} contributed</span>
                                </div>
                              </>
                            ) : (
                              <p className="mt-1.5 text-xs text-slate-400">
                                {s.paymentsPaid ?? 0} payment{(s.paymentsPaid ?? 0) === 1 ? '' : 's'} ·{' '}
                                {naira(s.totalContributed ?? 0)} contributed
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <Link to="/contribution" className="btn-primary mt-5 w-full">
                      Manage contributions <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                ) : (
                  <>
                    <p className="mt-3 text-sm text-slate-500">
                      You haven&apos;t joined a contribution plan yet.
                    </p>
                    <Link to="/contribution" className="btn-primary mt-5 w-full">
                      Start contributing <ArrowRight className="h-4 w-4" />
                    </Link>
                  </>
                )}
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="card-light p-6">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-bold text-slate-900">Recent contributions</h3>
                </div>
                {allHistory.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No contributions yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {allHistory.slice(0, 5).map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {naira(payment.amount)}
                          </p>
                          <p className="text-xs text-slate-400">
                            {payment.plan?.name ?? ''} · {formatDate(payment.paidAt ?? payment.createdAt)}
                          </p>
                        </div>
                        {payment.status === 'verified' ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                            Verified
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                            Pending
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Reveal>
          </div>
        </>
      )}
    </div>
  );
}
