import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Network,
  PiggyBank,
  Wallet,
  Landmark,
  Share2,
  Sparkles,
  Receipt,
  Bell,
  CalendarClock,
  Copy,
  Check,
  TrendingUp,
  Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { nairaCompact, formatDate, initials } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';

const RANK_LABELS = {
  marketer: 'Marketer',
  manager: 'Manager',
  director: 'Director',
  ruby_director: 'Ruby Director',
  diamond_director: 'Diamond Director',
};

const QUICK_ACTIONS = [
  { label: 'Add money', to: '/wallet', icon: Wallet, tint: 'bg-primary/10 text-primary' },
  { label: 'Withdraw', to: '/withdraw', icon: Landmark, tint: 'bg-slate-100 text-slate-700' },
  { label: 'Contribute', to: '/contribution', icon: PiggyBank, tint: 'bg-emerald-50 text-emerald-600' },
  { label: 'MLM', to: '/mlm', icon: Network, tint: 'bg-violet-50 text-violet-600' },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [sc, setSc] = useState(null);
  const [contrib, setContrib] = useState(null);
  const [mlm, setMlm] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api('/wallet')
      .then(setWallet)
      .catch(() => setWallet({ balance: 0 }));
    api('/service-charges')
      .then(setSc)
      .catch(() => setSc(null));
    api('/contributions/overview')
      .then(setContrib)
      .catch(() => setContrib(null));
    api('/mlm/overview')
      .then(setMlm)
      .catch(() => setMlm(null));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const latestCharges = sc?.charges?.slice(0, 5) ?? [];
  const pendingNotifications = sc?.notifications?.filter((n) => !n.read) ?? [];

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(user?.referralCode ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the code stays visible in the field below.
    }
  };

  const activePlan = contrib?.subscription?.plan?.name ?? null;
  const nextPayment = contrib?.subscription?.nextPaymentDate
    ? formatDate(contrib?.subscription?.nextPaymentDate)
    : null;
  const contributed = contrib?.totalContributed ?? 0;
  const rankLabel = RANK_LABELS[mlm?.currentRank] ?? null;
  const heldBalance = wallet?.heldBalance ?? 0;
  const totalContributed = wallet?.totalContributed ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-24 pb-14 sm:px-6 sm:pt-28">
      {/* Greeting — compact */}
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-neon text-sm font-extrabold text-white sm:h-12 sm:w-12">
          {initials(user?.fullName)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-slate-900 sm:text-xl">
            {greeting}, {user?.fullName?.split(' ')[0]} 👋
          </h1>
          <span
            className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              user?.activationStatus
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            <Sparkles className="h-3 w-3" />
            {user?.activationStatus ? 'Account activated' : 'Activation required'}
          </span>
        </div>
        {sc && (
          <button
            onClick={() => setShowNotifications((v) => !v)}
            className="relative inline-flex shrink-0 items-center rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label={`Notifications${pendingNotifications.length ? ` (${pendingNotifications.length} unread)` : ''}`}
            aria-expanded={showNotifications}
          >
            <Bell className="h-5 w-5 text-primary" />
            {pendingNotifications.length > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {pendingNotifications.length}
              </span>
            )}
          </button>
        )}
      </header>

      {showNotifications && sc && (
        <section className="mt-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-900">Notifications</span>
            <button
              onClick={() =>
                api('/service-charges/notifications/read', { method: 'POST' }).then(() =>
                  setSc((prev) => ({
                    ...prev,
                    notifications: (prev?.notifications ?? []).map((n) => ({ ...n, read: true })),
                  })),
                )
              }
              className="text-xs font-semibold text-primary hover:underline"
            >
              Mark all read
            </button>
          </div>
          {sc.notifications.length === 0 ? (
            <p className="text-sm text-slate-500">No notifications yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {sc.notifications.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 rounded-xl px-3 py-2 text-sm ${
                    n.read ? 'bg-slate-50 text-slate-500' : 'bg-primary/5 text-slate-800'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      n.type === 'error' ? 'bg-red-500' : n.type === 'success' ? 'bg-emerald-500' : 'bg-primary'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="font-semibold">{n.title}</p>
                    <p className="text-xs text-slate-500">{n.body}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{formatDate(n.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Primary wallet balance */}
      <section className="relative mt-6 overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-ink p-5 text-white sm:p-6">
        <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-40 w-40 rounded-full bg-neon/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/60">
              <Wallet className="h-4 w-4" /> Wallet balance
            </p>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-white/60">
              Contributed {nairaCompact(totalContributed)}
            </span>
          </div>

          <p className="mt-2 font-display text-4xl font-bold tracking-tight">
            {nairaCompact(wallet?.balance ?? 0)}
          </p>

          {heldBalance > 0 && (
            <p className="mt-1 text-xs text-white/40">Held: {nairaCompact(heldBalance)} (pending withdrawals)</p>
          )}

          <div className="mt-4 flex items-center gap-2.5">
            <Link
              to="/wallet"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-neon px-5 py-2.5 text-sm font-bold text-ink transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon/60"
            >
              + Add money
            </Link>
            <Link
              to="/withdraw"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-white/50 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
            >
              Withdraw
            </Link>
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <nav className="mt-4 grid grid-cols-4 gap-2" aria-label="Quick actions">
        {QUICK_ACTIONS.map((action) => (
          <Link
            key={action.label}
            to={action.to}
            className="flex min-h-[74px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-100 bg-white px-1 py-2.5 text-center shadow-card transition hover:-translate-y-0.5 hover:shadow-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${action.tint}`}>
              <action.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="max-w-full truncate text-[11px] font-semibold text-slate-700" title={action.label}>
              {action.label}
            </span>
          </Link>
        ))}
      </nav>

      {/* Referral + subscription */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-500">
            <Share2 className="h-4 w-4 text-primary" /> Your referral code
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-sm font-semibold tracking-wide text-primary"
              title={user?.referralCode}
            >
              {user?.referralCode}
            </p>
            <button
              onClick={copyCode}
              className="inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              aria-label="Copy referral code"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Share it with friends to start earning.</p>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-slate-500">
              <Receipt className="h-4 w-4 shrink-0 text-emerald-600" /> Monthly subscription
            </p>
            <span className="shrink-0 font-display text-lg font-bold tracking-tight text-emerald-700">
              {nairaCompact(sc?.monthlyFeeKobo ?? 30000)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">Keeps your plans active.</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {sc?.serviceChargeEnabled === false ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                <CalendarClock className="h-3.5 w-3.5" /> Collection inactive — you will not be charged.
              </span>
            ) : (
              <>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                  This month:
                  {sc?.currentMonthStatus === 'collected' ? (
                    <span className="font-semibold text-emerald-600">{sc?.currentMonth} (paid)</span>
                  ) : (
                    <span className="font-semibold text-slate-700">{sc?.currentMonth}</span>
                  )}
                </span>
                {sc?.nextChargeDate && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <CalendarClock className="h-3.5 w-3.5 text-emerald-600" />
                    Next {formatDate(sc.nextChargeDate)}
                  </span>
                )}
              </>
            )}
            {sc?.currentMonthStatus === 'insufficient_funds' && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600">
                Balance insufficient
              </span>
            )}
          </div>
        </section>
      </div>

      {/* Contribution + MLM summary */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-500">
            <TrendingUp className="h-4 w-4 text-emerald-600" /> Contribution
          </div>
          <p className="mt-2.5 truncate text-base font-bold text-slate-900">{activePlan ?? 'No active plan'}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{nairaCompact(contributed)} contributed</p>
          <p className="mt-1 truncate text-xs text-slate-400">
            Next {nextPayment ?? '—'}
          </p>
        </section>

        <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-500">
            <Network className="h-4 w-4 text-violet-600" /> MLM earnings
          </div>
          <p className="mt-2.5 text-base font-bold text-slate-900">{nairaCompact(mlm?.totalBonusEarned ?? 0)}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-500">
            <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            {mlm?.directCount ?? 0} direct referrals
          </p>
          <p className="mt-1 truncate text-xs text-slate-400">Rank: {rankLabel ?? '—'}</p>
        </section>
      </div>

      {/* Recent service charges */}
      {latestCharges.length > 0 && (
        <section className="mt-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
          <div className="text-sm font-bold text-slate-900">Recent service charges</div>
          <ul className="mt-2 space-y-1.5">
            {latestCharges.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold text-slate-800">{nairaCompact(c.amountKobo)}</p>
                  <p className="text-xs text-slate-400">{c.billingMonth}</p>
                </div>
                <div className="text-right">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      c.status === 'collected'
                        ? 'bg-emerald-50 text-emerald-600'
                        : c.status === 'insufficient_funds'
                          ? 'bg-red-50 text-red-500'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {c.status === 'collected' ? 'Deducted' : c.status === 'insufficient_funds' ? 'Failed' : c.status}
                  </span>
                  <p className="mt-0.5 text-[11px] text-slate-400">{formatDate(c.collectedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Platform links — compact */}
      <h2 className="mt-6 text-base font-bold text-slate-900 sm:text-lg">Your platforms</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Link to="/mlm" className="group block">
          <div className="flex h-full items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-glow">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 transition-colors group-hover:bg-primary">
              <Network className="h-5 w-5 text-primary transition-colors group-hover:text-white" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">MLM Platform</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Referral bonuses across 3 levels, from Marketer to Diamond Director.
              </p>
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">Open →</span>
            </div>
          </div>
        </Link>

        <Link to="/contribution" className="group block">
          <div className="flex h-full items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-card transition hover:-translate-y-0.5 hover:shadow-glow">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 transition-colors group-hover:bg-emerald-500">
              <PiggyBank className="h-5 w-5 text-emerald-600 transition-colors group-hover:text-white" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">Contributions</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Save monthly or join a weekly AJO cohort and collect the pool on your turn.
              </p>
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">Open →</span>
            </div>
          </div>
        </Link>
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Member since {formatDate(user?.createdAt)}
      </p>
    </div>
  );
}