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
import { naira, formatDate, formatDateTime } from '../lib/format.js';
import Reveal from '../components/Reveal.jsx';

export default function Wallet() {
  const [wallet, setWallet] = useState(null);
  const [overview, setOverview] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ amountKobo: '', bankName: '', bankCode: '', accountNumber: '' });
  const [formError, setFormError] = useState('');
  const [formMsg, setFormMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadWithdrawals = () =>
    api('/wallet/withdrawals')
      .then((d) => setWithdrawals(d.withdrawals ?? []))
      .catch(() => {});

  useEffect(() => {
    api('/wallet')
      .then(setWallet)
      .catch((err) => setError(err.message ?? 'Could not load wallet'));

    api('/contributions/overview')
      .then(setOverview)
      .catch(() => setOverview(null));

    loadWithdrawals();
  }, []);

  const progressPercent = Math.round((overview?.progress ?? 0) * 100);
  const subscription = overview?.subscription;
  const balance = wallet?.balance ?? 0;
  const heldBalance = wallet?.heldBalance ?? 0;
  const available = balance;

  const submitWithdrawal = async (e) => {
    e.preventDefault();
    setFormError('');
    setFormMsg('');
    setSubmitting(true);
    try {
      const amountKobo = Math.round(Number(form.amountKobo) * 100);
      if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
        throw new Error('Enter a valid amount');
      }
      await api('/wallet/withdrawals', {
        method: 'POST',
        body: {
          amountKobo,
          bank: {
            bankName: form.bankName,
            bankCode: form.bankCode,
            accountNumber: form.accountNumber,
          },
        },
      });
      setFormMsg('Withdrawal requested — funds reserved pending verification.');
      setForm({ amountKobo: '', bankName: '', bankCode: '', accountNumber: '' });
      setWallet(await api('/wallet'));
      loadWithdrawals();
    } catch (err) {
      setFormError(err.message ?? 'Could not request withdrawal');
    } finally {
      setSubmitting(false);
    }
  };

  const withdrawalStatusBadge = (status) => {
    const map = {
      SUCCESS: 'bg-emerald-50 text-emerald-600',
      PENDING: 'bg-amber-50 text-amber-600',
      PROCESSING: 'bg-sky-50 text-sky-600',
      FAILED: 'bg-red-50 text-red-600',
      REVERSED: 'bg-purple-50 text-purple-600',
      CANCELLED: 'bg-slate-100 text-slate-500',
    };
    return map[status] ?? 'bg-slate-100 text-slate-500';
  };

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
                  From verified weekly AJO contributions
                  {subscription ? ` · ${overview?.weeksPaid ?? 0}/${overview?.cycleWeeks ?? 52} weeks` : ''}
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

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <Reveal>
              <div className="card-light p-6">
                <div className="flex items-center gap-2">
                  <Landmark className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-bold text-slate-900">Request a withdrawal</h3>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Available balance{' '}
                  <span className="font-semibold text-slate-700">{naira(balance)}</span>
                  {heldBalance > 0 && (
                    <span className="ml-1">
                      · {naira(heldBalance)} held in pending requests
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Funds are reserved immediately and released only after admin verification.
                </p>
                <form onSubmit={submitWithdrawal} className="mt-4 space-y-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-500">Amount (₦)</label>
                    <input
                      type="number"
                      min="1"
                      step="any"
                      required
                      value={form.amountKobo}
                      onChange={(e) => setForm((f) => ({ ...f, amountKobo: e.target.value }))}
                      placeholder="e.g. 5000"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500">Bank name</label>
                    <input
                      required
                      value={form.bankName}
                      onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                      placeholder="e.g. GTBank"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500">Bank code</label>
                    <input
                      required
                      value={form.bankCode}
                      onChange={(e) => setForm((f) => ({ ...f, bankCode: e.target.value }))}
                      placeholder="e.g. 058"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500">Account number</label>
                    <input
                      required
                      inputMode="numeric"
                      pattern="[0-9]{10}"
                      value={form.accountNumber}
                      onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
                      placeholder="10-digit account number"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>
                  {formError && <p className="text-xs font-medium text-red-600">{formError}</p>}
                  {formMsg && <p className="text-xs font-medium text-emerald-600">{formMsg}</p>}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary w-full disabled:opacity-60"
                  >
                    {submitting ? 'Requesting…' : 'Request withdrawal'}
                  </button>
                </form>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="card-light p-6">
                <div className="flex items-center gap-2">
                  <History className="h-5 w-5 text-primary" />
                  <h3 className="text-base font-bold text-slate-900">Withdrawals</h3>
                </div>
                {withdrawals.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No withdrawal requests yet.</p>
                ) : (
                  <ul className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                    {withdrawals.map((w) => (
                      <li
                        key={w.id}
                        className="flex items-center justify-between rounded-xl border border-slate-100 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{naira(w.amountKobo)}</p>
                          <p className="text-xs text-slate-400">
                            {w.bankName ?? 'Bank'} · {formatDateTime(w.createdAt)}
                          </p>
                          {w.failureReason && (
                            <p className="mt-0.5 text-xs text-slate-400">{w.failureReason}</p>
                          )}
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${withdrawalStatusBadge(
                            w.status,
                          )}`}
                        >
                          {w.status.toLowerCase()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
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
                      <span>{progressPercent}% of 52-week cycle</span>
                      <span>
                        {overview?.weeksPaid ?? 0}/{overview?.cycleWeeks ?? 52} weeks
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      Plan: <span className="font-semibold text-slate-800">{subscription.plan.name}</span> ·{' '}
                      {naira(subscription.plan.weeklyAmount)}/week
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
