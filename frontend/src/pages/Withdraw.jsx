import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  History,
  Landmark,
  Lock,
  ShieldCheck,
  Wallet as WalletIcon,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { naira, formatDateTime } from '../lib/format.js';
import Reveal from '../components/Reveal.jsx';

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

const maskAccount = (accountNumber) =>
  accountNumber && accountNumber.length > 4 ? `••••••${accountNumber.slice(-4)}` : (accountNumber ?? '');

export default function Withdraw() {
  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState([]);
  const [loadError, setLoadError] = useState('');

  const [amount, setAmount] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  const loadWallet = () =>
    api('/wallet')
      .then(setWallet)
      .catch((err) => setLoadError(err.message ?? 'Could not load wallet'));

  const loadWithdrawals = () =>
    api('/wallet/withdrawals')
      .then((d) => setWithdrawals(d.withdrawals ?? []))
      .catch(() => {});

  useEffect(() => {
    loadWallet();
    loadWithdrawals();
  }, []);

  // Authoritative available balance: wallet.balance is what the withdrawal
  // backend validates against and reserves from; heldBalance is already
  // excluded from balance at request time.
  const balance = wallet?.balance ?? 0;
  const heldBalance = wallet?.heldBalance ?? 0;
  const hasActiveRequest = withdrawals.some(
    (w) => w.status === 'PENDING' || w.status === 'PROCESSING',
  );

  const submitWithdrawal = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitted(null);

    const amountKobo = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    if (amountKobo > balance) {
      setFormError(`Amount exceeds your available balance (${naira(balance)}).`);
      return;
    }

    setSubmitting(true);
    try {
      const { withdrawal } = await api('/wallet/withdrawals', {
        method: 'POST',
        body: {
          amountKobo,
          bank: { bankName, bankCode, accountNumber },
        },
      });
      setSubmitted(withdrawal);
      setAmount('');
      setBankName('');
      setBankCode('');
      setAccountNumber('');
      await Promise.all([loadWallet(), loadWithdrawals()]);
    } catch (err) {
      setFormError(err.message ?? 'Could not request withdrawal');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container-lp pt-28 pb-16">
      <Link
        to="/wallet"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Wallet
      </Link>

      <div className="mt-5 flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Withdraw</span>
        <h1 className="section-title text-slate-900">Request Withdrawal</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Withdraw available funds from your LaaniPay wallet.
        </p>
      </div>

      {loadError && (
        <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {loadError}
        </div>
      )}

      {!wallet && !loadError && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {wallet && (
        <div className="mt-8 space-y-6">
          <Reveal>
            <div className="card-light relative overflow-hidden p-6 sm:p-8">
              <div className="hero-gradient absolute inset-0 opacity-10" />
              <div className="relative">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                  <WalletIcon className="h-4 w-4 shrink-0 text-primary" /> Available balance
                </div>
                <p className="mt-2 text-4xl font-extrabold text-slate-900 sm:text-5xl">{naira(balance)}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-600">
                    <ShieldCheck className="h-3 w-3" /> Verified wallet balance
                  </span>
                  {heldBalance > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-600">
                      <Lock className="h-3 w-3" /> {naira(heldBalance)} held in pending requests
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="card-light p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" />
                <h3 className="text-base font-bold text-slate-900">Request Withdrawal</h3>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Funds are reserved immediately and released only after admin verification.
              </p>

              {submitted && (
                <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50 p-5">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <h4 className="text-sm font-bold text-emerald-800">Withdrawal request submitted</h4>
                  </div>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-emerald-700">Amount</dt>
                      <dd className="font-semibold text-emerald-800">{naira(submitted.amountKobo)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-emerald-700">Status</dt>
                      <dd>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${withdrawalStatusBadge(
                            submitted.status,
                          )}`}
                        >
                          {submitted.status.toLowerCase()}
                        </span>
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-emerald-700">Reference</dt>
                      <dd className="font-mono text-xs text-emerald-800">{submitted.id}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-xs text-emerald-700">
                    Your funds have been reserved. An admin will verify and release your withdrawal —
                    no money has been transferred yet.
                  </p>
                </div>
              )}

              {hasActiveRequest && !submitted && (
                <p className="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  You already have a pending withdrawal request. You can request another only after
                  the current one is resolved.
                </p>
              )}

              <form onSubmit={submitWithdrawal} className="mt-5 space-y-4 sm:mt-6">
                <div>
                  <label className="text-xs font-semibold text-slate-500">Amount (₦)</label>
                  <input
                    type="number"
                    min="1"
                    step="any"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 5000"
                    className="input mt-1"
                  />
                  {amount && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {Number(amount) > 0
                        ? `Up to ${naira(balance)} available to withdraw.`
                        : 'Enter an amount above zero.'}
                    </p>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-slate-500">Bank name</label>
                    <input
                      required
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="e.g. GTBank"
                      className="input mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500">Bank code</label>
                    <input
                      required
                      value={bankCode}
                      onChange={(e) => setBankCode(e.target.value)}
                      placeholder="e.g. 058"
                      className="input mt-1"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500">Account number</label>
                  <input
                    required
                    inputMode="numeric"
                    maxLength={10}
                    pattern="[0-9]{10}"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                    placeholder="10-digit account number"
                    className="input mt-1"
                  />
                </div>
                {formError && <p className="text-xs font-medium text-red-600">{formError}</p>}
                <button type="submit" disabled={submitting} className="btn-primary w-full disabled:opacity-60">
                  {submitting ? 'Requesting…' : 'Request withdrawal'}
                </button>
              </form>
            </div>
          </Reveal>

          <Reveal delay={160}>
            <div className="card-light p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                <h3 className="text-base font-bold text-slate-900">Withdrawal History</h3>
              </div>
              {withdrawals.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No withdrawal requests yet.</p>
              ) : (
                <ul className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {withdrawals.map((w) => (
                    <li key={w.id} className="rounded-xl border border-slate-100 px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-slate-800">{naira(w.amountKobo)}</p>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${withdrawalStatusBadge(
                            w.status,
                          )}`}
                        >
                          {w.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs text-slate-400">{formatDateTime(w.createdAt)}</p>
                      <p className="mt-0.5 truncate font-mono text-xs text-slate-400">Ref {w.id}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {w.bankName ?? 'Bank'}
                        {w.accountNumber ? ` · ${maskAccount(w.accountNumber)}` : ''}
                      </p>
                      {w.failureReason && <p className="mt-1 text-xs text-red-500">{w.failureReason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Reveal>
        </div>
      )}
    </div>
  );
}