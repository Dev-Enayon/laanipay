import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet as WalletIcon, PiggyBank, TrendingUp, History, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { naira, formatDate } from '../lib/format.js';
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

  const progressPercent = Math.round((overview?.progress ?? 0) * 100);
  const subscription = overview?.subscription;

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
              <div className="card-light relative overflow-hidden p-8">
                <div className="hero-gradient absolute inset-0 opacity-10" />
                <div className="relative flex items-center gap-2 text-sm font-medium text-slate-500">
                  <PiggyBank className="h-4 w-4 text-primary" /> Total contributed
                </div>
                <p className="relative mt-2 text-4xl font-extrabold text-slate-900">
                  {naira(wallet.totalContributed ?? 0)}
                </p>
                <p className="relative mt-2 text-xs text-slate-400">
                  From verified monthly contributions
                  {subscription ? ` · ${overview?.monthsPaid ?? 0}/${overview?.cycleMonths ?? 12} months` : ''}
                </p>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="card-light relative overflow-hidden p-8">
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-neon/10 blur-3xl" />
                <div className="relative flex items-center gap-2 text-sm font-medium text-slate-500">
                  <TrendingUp className="h-4 w-4 text-primary" /> Referral earnings balance
                </div>
                <p className="relative mt-2 text-4xl font-extrabold text-slate-900">
                  {naira(wallet.balance ?? 0)}
                </p>
                <p className="relative mt-2 text-xs text-slate-400">MLM bonuses credited to you</p>
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
                {subscription ? (
                  <>
                    <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-neon transition-all duration-700"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
                      <span>{progressPercent}% of 12-month cycle</span>
                      <span>
                        {overview?.monthsPaid ?? 0}/{overview?.cycleMonths ?? 12} months
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      Plan: <span className="font-semibold text-slate-800">{subscription.plan.name}</span> ·{' '}
                      {naira(subscription.plan.monthlyAmount)}/month
                    </p>
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
                {overview?.history?.length === 0 || !overview?.history ? (
                  <p className="mt-3 text-sm text-slate-500">No contributions yet.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {overview.history.slice(0, 5).map((payment) => (
                      <li
                        key={payment.id}
                        className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            {naira(payment.amount)}
                          </p>
                          <p className="text-xs text-slate-400">
                            {formatDate(payment.paidAt ?? payment.createdAt)}
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
