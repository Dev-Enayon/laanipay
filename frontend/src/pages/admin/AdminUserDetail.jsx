import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Wallet,
  PiggyBank,
  Network,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  Ban,
  CircleCheck,
  Plus,
  Minus,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { naira, formatDate, formatDateTime, initials } from '../../lib/format.js';
import { StatusBadge, TxTypeBadge } from './badges.jsx';

function ConfirmModal({ open, title, body, confirmLabel, danger, onClose, onConfirm, reason, setReason, requireReason, extra }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 px-4">
      <div className="card-light w-full max-w-md p-6">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{body}</p>
        {extra}
        {requireReason && (
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            rows={3}
            className="input mt-4"
          />
        )}
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={requireReason && !reason.trim()}
            className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, accent }) {
  return (
    <div className="card-light p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
        <Icon className={`h-4 w-4 ${accent}`} /> {label}
      </div>
      <p className="mt-2 text-xl font-extrabold text-slate-900">{value}</p>
    </div>
  );
}

export default function AdminUserDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [modal, setModal] = useState(null); // 'suspend' | 'reactivate' | 'deposit' | 'withdraw'
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');

  const load = () => {
    setMessage('');
    api(`/admin/users/${id}`)
      .then(setData)
      .catch((err) => setError(err.message ?? 'Could not load user'));
  };

  useEffect(load, [id]);

  const runAction = async (fn, successMsg) => {
    setBusy(true);
    try {
      await fn();
      setMessage(successMsg);
      setModal(null);
      setReason('');
      setAmount('');
      load();
    } catch (err) {
      setError(err.message ?? 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const confirmSuspend = () =>
    runAction(
      () => api(`/admin/users/${id}/suspend`, { method: 'POST', body: { reason } }),
      'Account suspended',
    );

  const confirmReactivate = () =>
    runAction(
      () => api(`/admin/users/${id}/reactivate`, { method: 'POST', body: { reason } }),
      'Account reactivated',
    );

  const confirmWallet = () => {
    const amountNum = parseInt(amount, 10) * 100;
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Enter a valid amount');
      return;
    }
    const type = modal === 'deposit' ? 'deposit' : 'withdrawal';
    runAction(
      () => api(`/admin/users/${id}/wallet`, { method: 'POST', body: { type, amount: amountNum, note: reason } }),
      modal === 'deposit' ? 'Deposit applied' : 'Withdrawal applied',
    );
  };

  if (error) {
    return (
      <div>
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>
        <Link to="/admin/users" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Back to users
        </Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const { user, wallet, transactions, contribution, mlm } = data;
  const suspended = user.status === 'suspended';

  return (
    <div>
      <Link to="/admin/users" className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to users
      </Link>

      {message && <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{message}</div>}
      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>}

      <div className="card-light mt-4 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-neon text-lg font-extrabold text-white">
              {initials(user.fullName)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900">{user.fullName}</h2>
                <StatusBadge status={user.status} />
              </div>
              <p className="text-sm text-slate-500">
                {user.email} · {user.phone}
              </p>
              <p className="text-xs text-slate-400">
                Registered {formatDate(user.createdAt)} · {user.role === 'admin' ? 'Administrator' : 'Member'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!suspended ? (
              <button
                onClick={() => { setModal('suspend'); setReason(''); }}
                className="inline-flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-600"
              >
                <Ban className="h-4 w-4" /> Suspend
              </button>
            ) : (
              <button
                onClick={() => { setModal('reactivate'); setReason(''); }}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600"
              >
                <CircleCheck className="h-4 w-4" /> Reactivate
              </button>
            )}
            <button
              onClick={() => { setModal('deposit'); setReason(''); setAmount(''); }}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary-dark"
            >
              <Plus className="h-4 w-4" /> Deposit
            </button>
            <button
              onClick={() => { setModal('withdraw'); setReason(''); setAmount(''); }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold text-slate-600 hover:border-red-300 hover:text-red-500"
            >
              <Minus className="h-4 w-4" /> Withdraw
            </button>
          </div>
        </div>

        {suspended && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldAlert className="h-4 w-4" /> Suspended {user.suspendedAt ? formatDateTime(user.suspendedAt) : ''}
            </div>
            <p className="mt-1 text-xs">{user.suspendedReason}</p>
          </div>
        )}
        {user.reactivatedAt && (
          <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <div className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-4 w-4" /> Reactivated {formatDateTime(user.reactivatedAt)}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Wallet} label="Wallet balance" value={naira(wallet.balance)} accent="text-primary" />
        <Stat icon={PiggyBank} label="Total contributed" value={naira(wallet.totalContributed)} accent="text-emerald-600" />
        <Stat icon={Minus} label="Total withdrawn" value={naira(wallet.totalWithdrawn)} accent="text-red-500" />
        <Stat icon={Network} label="MLM earnings" value={naira(mlm.bonusesEarned)} accent="text-violet-600" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="card-light p-6">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <PiggyBank className="h-5 w-5 text-primary" /> Contribution
          </h3>
          {contribution.subscription ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-400">Plan</p>
                  <p className="font-semibold text-slate-800">{contribution.subscription.plan.name}</p>
                  <p className="text-xs text-slate-500">{naira(contribution.subscription.plan.monthlyAmount)}/mo</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Next payment</p>
                  <p className="font-semibold text-slate-800">{formatDate(contribution.subscription.nextPaymentDate)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Months paid</p>
                  <p className="font-semibold text-slate-800">{contribution.monthsPaid}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Total contributed</p>
                  <p className="font-semibold text-emerald-600">{naira(contribution.totalContributed)}</p>
                </div>
              </div>
              {contribution.history.length > 0 && (
                <div className="mt-4 max-h-40 space-y-2 overflow-y-auto">
                  {contribution.history.map((p) => (
                    <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
                      <span className="font-semibold text-slate-700">{naira(p.amount)}</span>
                      <span className="font-mono text-slate-400">{p.reference.slice(0, 16)}…</span>
                      <StatusBadge status={p.status} />
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No active contribution plan.</p>
          )}
        </div>

        <div className="card-light p-6">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Network className="h-5 w-5 text-primary" /> MLM
          </h3>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-400">Tree level</p>
              <p className="font-semibold text-slate-800">Level {mlm.depth}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Current rank</p>
              <p className="font-semibold capitalize text-slate-800">{mlm.currentRank?.replace(/_/g, ' ') ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Direct referrals</p>
              <p className="font-semibold text-slate-800">{mlm.directCount}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Direct activated</p>
              <p className="font-semibold text-slate-800">{mlm.directActivated}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Total downline</p>
              <p className="font-semibold text-slate-800">{mlm.totalDownline}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Referral earnings</p>
              <p className="font-semibold text-emerald-600">{naira(mlm.bonusesEarned)}</p>
            </div>
          </div>
          {mlm.referrer && (
            <p className="mt-3 text-xs text-slate-400">
              Referred by: <span className="font-semibold text-slate-600">{mlm.referrer.fullName}</span> ({mlm.referrer.email})
            </p>
          )}
          {mlm.downline.length > 0 && (
            <div className="mt-4 max-h-40 space-y-2 overflow-y-auto">
              {mlm.downline.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs">
                  <span className="font-medium text-slate-700">{m.fullName}</span>
                  <span className="text-slate-400">Level {m.level} · {naira(m.bonusEarned)}</span>
                  <StatusBadge status={m.activationStatus ? 'active' : 'pending'} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card-light mt-6 p-6">
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Wallet className="h-5 w-5 text-primary" /> Wallet transaction history
        </h3>
        {transactions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No wallet transactions yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2">Balance after</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-3 py-2"><TxTypeBadge type={t.type} /></td>
                    <td className="px-3 py-2 font-semibold text-slate-800">{naira(t.amount)}</td>
                    <td className="px-3 py-2 text-slate-600">{naira(t.balanceAfter)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{t.description ?? '—'}</td>
                    <td className="px-3 py-2"><StatusBadge status={t.status} /></td>
                    <td className="px-3 py-2 text-xs text-slate-500">{formatDateTime(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={modal === 'suspend'}
        title="Suspend this account?"
        body={`Suspending ${user.fullName} will block login and all wallet/financial activity. Their records are preserved.`}
        confirmLabel={busy ? 'Suspending...' : 'Suspend account'}
        danger
        requireReason
        reason={reason}
        setReason={setReason}
        onClose={() => setModal(null)}
        onConfirm={confirmSuspend}
      />
      <ConfirmModal
        open={modal === 'reactivate'}
        title="Reactivate this account?"
        body={`Restore normal platform access for ${user.fullName}?`}
        confirmLabel={busy ? 'Reactivating...' : 'Reactivate account'}
        requireReason={false}
        reason={reason}
        setReason={setReason}
        onClose={() => setModal(null)}
        onConfirm={confirmReactivate}
      />
      <ConfirmModal
        open={modal === 'deposit' || modal === 'withdraw'}
        title={modal === 'deposit' ? 'Manual wallet deposit' : 'Manual wallet withdrawal'}
        body={`Enter the amount in naira to ${modal === 'deposit' ? 'credit' : 'debit'} ${user.fullName}'s wallet.`}
        confirmLabel={busy ? 'Applying...' : modal === 'deposit' ? 'Deposit' : 'Withdraw'}
        danger={modal === 'withdraw'}
        requireReason
        reason={reason}
        setReason={setReason}
        onClose={() => setModal(null)}
        onConfirm={confirmWallet}
        extra={
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
            placeholder="Amount in naira, e.g. 1000"
            type="text"
            inputMode="numeric"
            className="input mt-4"
          />
        }
      />
    </div>
  );
}
