import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Network,
  PiggyBank,
  Wallet,
  Share2,
  Sparkles,
  Receipt,
  Bell,
  CalendarClock,
  CalendarDays,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { nairaCompact, formatDate, initials } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [sc, setSc] = useState(null);
  const [showNotifications, setShowNotifications] = useState(false);

  useEffect(() => {
    api('/wallet')
      .then((data) => setWallet(data))
      .catch(() => setWallet({ balance: 0 }));
    api('/service-charges')
      .then(setSc)
      .catch(() => setSc(null));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const latestCharges = sc?.charges?.slice(0, 5) ?? [];
  const pendingNotifications = sc?.notifications?.filter((n) => !n.read) ?? [];

  return (
    <div className="container-lp pt-28 pb-16">
      <div className="card-light relative overflow-hidden p-8">
        <div className="hero-gradient absolute inset-0 opacity-10" />
        <div className="relative flex items-center gap-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-neon text-xl font-extrabold text-white">
            {initials(user?.fullName)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {greeting}, {user?.fullName?.split(' ')[0]} 👋
            </h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-600">
              <Sparkles className="h-4 w-4" />
              Account activated — welcome to the ecosystem.
            </p>
          </div>
          {sc && (
            <button
              onClick={() => setShowNotifications((v) => !v)}
              className="relative ml-auto inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <Bell className="h-4 w-4 text-primary" /> Notifications
              {pendingNotifications.length > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {pendingNotifications.length}
                </span>
              )}
            </button>
          )}
        </div>

        {showNotifications && sc && (
          <div className="relative mt-4 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-slate-900">Notifications</span>
              <button
                onClick={() => api('/service-charges/notifications/read', { method: 'POST' }).then(() =>
                  setSc((prev) => ({ ...prev, notifications: (prev?.notifications ?? []).map((n) => ({ ...n, read: true })) })),
                )}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Mark all read
              </button>
            </div>
            {sc.notifications.length === 0 ? (
              <p className="text-sm text-slate-500">No notifications yet.</p>
            ) : (
              <ul className="space-y-2">
                {sc.notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm ${
                      n.read ? 'bg-slate-50 text-slate-500' : 'bg-primary/5 text-slate-800'
                    }`}
                  >
                    <span
                      className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                        n.type === 'error' ? 'bg-red-500' : n.type === 'success' ? 'bg-emerald-500' : 'bg-primary'
                      }`}
                    />
                    <div>
                      <p className="font-semibold">{n.title}</p>
                      <p className="text-xs text-slate-500">{n.body}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400">{formatDate(n.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="relative mt-8 grid gap-4 sm:grid-cols-2">
          <Link to="/wallet" className="group rounded-2xl border border-slate-100 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-glow">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Wallet className="h-4 w-4 text-primary" /> Wallet balance
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">
              {nairaCompact(wallet?.balance ?? 0)}
            </p>
            <p className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span>MLM referral earnings</span>
              <span className="font-semibold text-emerald-600">
                {nairaCompact(wallet?.totalContributed ?? 0)} contributed
              </span>
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Open wallet →
            </span>
          </Link>
          <div className="rounded-2xl border border-slate-100 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Share2 className="h-4 w-4 text-primary" /> Your referral code
            </div>
            <p className="mt-2 font-mono text-2xl font-extrabold tracking-wider text-primary break-all">
              {user?.referralCode}
            </p>
            <p className="mt-1 text-xs text-slate-400">Share it with friends to start earning</p>
          </div>
        </div>

        <div className="relative mt-4 overflow-hidden rounded-2xl border border-neon/30 bg-neon/5 p-5 text-sm md:px-6 md:py-5">
          <div className="flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-2.5 font-bold text-slate-900">
              <Receipt className="h-5 w-5 shrink-0 text-emerald-600" />
              <span className="truncate">Monthly Service Charge</span>
            </p>
            <span className="shrink-0 text-xl font-extrabold tracking-tight text-emerald-700">₦500</span>
          </div>

          <p className="mt-3 max-w-xl leading-relaxed text-slate-500">
            A ₦500 service charge is deducted from your wallet monthly.
          </p>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-8 md:mt-3">
            {sc?.nextChargeDate && (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                <CalendarClock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                Next on {formatDate(sc.nextChargeDate)}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <CalendarDays className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              This month:
              {sc?.currentMonthStatus === 'collected' ? (
                <span className="font-semibold text-emerald-600"> {sc?.currentMonth} (paid)</span>
              ) : (
                <> {sc?.currentMonth}</>
              )}
            </span>
            {sc?.currentMonthStatus === 'insufficient_funds' && (
              <span className="mt-1 inline-flex w-fit items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600 sm:mt-0">
                Balance insufficient
              </span>
            )}
          </div>
        </div>

        {latestCharges.length > 0 && (
          <div className="relative mt-4 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-2 text-sm font-bold text-slate-900">Recent service charges</div>
            <ul className="space-y-2">
              {latestCharges.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
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
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {formatDate(c.collectedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h2 className="mt-12 text-lg font-bold text-slate-900">Choose your platform</h2>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <Link to="/mlm" className="group block">
          <div className="card-light h-full p-8 transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-glow">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 transition-colors group-hover:bg-primary">
              <Network className="h-7 w-7 text-primary transition-colors group-hover:text-white" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">MLM Platform</h3>
            <p className="mt-2 text-sm text-slate-600">
              Build your team, earn referral bonuses across 3 levels and climb from Marketer to
              Diamond Director.
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary">
              Open MLM platform →
            </span>
          </div>
        </Link>

        <Link to="/contribution" className="group block">
          <div className="card-light h-full p-8 transition-all duration-300 group-hover:-translate-y-1.5 group-hover:shadow-neon">
            <div className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-neon/15 transition-colors group-hover:bg-neon">
              <PiggyBank className="h-7 w-7 text-emerald-600 transition-colors group-hover:text-ink" />
            </div>
            <h3 className="text-xl font-bold text-slate-900">Contribution Platform</h3>
            <p className="mt-2 text-sm text-slate-600">
              Pick a monthly plan from ₦1,000 and build disciplined community savings with live
              progress tracking.
            </p>
            <span className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-emerald-600">
              Open contribution platform →
            </span>
          </div>
        </Link>
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        Member since {formatDate(user?.createdAt)}
      </p>
    </div>
  );
}

