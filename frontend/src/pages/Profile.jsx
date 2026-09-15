import { useEffect, useState } from 'react';
import {
  User,
  Mail,
  Phone,
  Copy,
  Check,
  Wallet,
  PiggyBank,
  Network,
  ShieldCheck,
  CalendarClock,
  Users,
  TrendingUp,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { nairaCompact, naira, formatDate, initials } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';

const RANK_LABELS = {
  marketer: 'Marketer',
  manager: 'Manager',
  director: 'Director',
  ruby_director: 'Ruby Director',
  diamond_director: 'Diamond Director',
};

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-card sm:p-5">
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
        <Icon className="h-4 w-4 text-primary" /> {label}
      </div>
      <p className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">{value}</p>
    </div>
  );
}

export default function Profile() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [contrib, setContrib] = useState(null);
  const [mlm, setMlm] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api('/wallet')
      .then(setWallet)
      .catch(() => setWallet(null));
    api('/contributions/overview')
      .then(setContrib)
      .catch(() => setContrib(null));
    api('/mlm/overview')
      .then(setMlm)
      .catch(() => setMlm(null));
  }, []);

  const referralCode = user?.referralCode ?? mlm?.referralCode ?? null;
  const plan = contrib?.subscription?.plan?.name ?? null;
  const planAmount = contrib?.subscription?.amount ?? null;
  const nextPayment = contrib?.subscription?.nextPaymentDate ? formatDate(contrib?.subscription?.nextPaymentDate) : null;
  const rankLabel = RANK_LABELS[mlm?.currentRank] ?? null;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(referralCode ?? '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the code stays visible in the field below.
    }
  };

  return (
    <div className="container-lp pb-16 pt-24 sm:pt-28">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-slate-900">
        <User className="h-6 w-6 text-primary" /> My Profile
      </h1>
      <p className="mt-1 text-sm text-slate-500">Your account details at a glance.</p>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card lg:col-span-2">
          <div className="bg-gradient-to-br from-slate-900 to-ink p-5 text-white sm:p-6">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-neon text-xl font-extrabold uppercase text-white">
              {initials(user?.fullName)}
            </span>
            <h2 className="mt-4 truncate text-xl font-bold">{user?.fullName}</h2>
            <p className="mt-0.5 flex items-center gap-1.5 text-sm text-white/60">
              <Mail className="h-4 w-4" /> {user?.email ?? '—'}
            </p>
          </div>
          <div className="space-y-4 p-5 sm:p-6">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Account status</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    user?.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-primary/10 text-primary'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {user?.role === 'admin' ? 'Administrator' : 'Member'}
                </span>
                {user?.activationStatus ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                    Activated
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                    Activation required
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Phone</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-800">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {user?.phone ?? '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Member since</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-800">
                  <CalendarClock className="h-4 w-4 text-slate-400" />
                  {formatDate(user?.createdAt)}
                </p>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Referral code</p>
              {referralCode ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="flex h-10 flex-1 items-center rounded-xl border border-slate-200 bg-slate-50 px-3">
                    <span className="truncate text-sm font-bold uppercase tracking-wider text-slate-900">{referralCode}</span>
                    <button
                      onClick={copyCode}
                      className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-primary/40 hover:text-primary"
                      title="Copy referral code"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-slate-500">—</p>
              )}
            </div>
          </div>
        </section>

        <div className="space-y-5 lg:col-span-3">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat icon={Wallet} label="Wallet balance" value={nairaCompact(wallet?.balance ?? 0)} />
            <Stat icon={PiggyBank} label="Total contributed" value={nairaCompact(wallet?.totalContributed ?? 0)} />
            <Stat icon={TrendingUp} label="MLM earnings" value={nairaCompact(mlm?.totalBonusEarned ?? 0)} />
          </div>

          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
            <h3 className="text-sm font-bold text-slate-900">Contribution plan</h3>
            {plan ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-2 font-semibold text-slate-800">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{plan}</span>
                  {planAmount != null && <span className="text-slate-600">{naira(planAmount)}</span>}
                </span>
                {nextPayment && <span className="text-slate-500">Next payment: {nextPayment}</span>}
              </div>
            ) : (
              <p className="mt-1 text-sm text-slate-500">No active contribution plan yet.</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">MLM overview</h3>
              {rankLabel && (
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700">{rankLabel}</span>
              )}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="flex items-center justify-center gap-1 text-lg font-bold text-slate-900">
                  <Users className="h-4 w-4 text-primary" /> {mlm?.directCount ?? 0}
                </p>
                <p className="text-[11px] font-medium text-slate-500">Direct referrals</p>
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">{mlm?.totalDownline ?? 0}</p>
                <p className="text-[11px] font-medium text-slate-500">Total downline</p>
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900">{mlm?.currentRank ? (RANK_LABELS[mlm.currentRank] ?? mlm.currentRank) : '—'}</p>
                <p className="text-[11px] font-medium text-slate-500">Current rank</p>
              </div>
            </div>
            {mlm?.rankAchievedAt && (
              <p className="mt-3 text-xs text-slate-400">Rank achieved {formatDate(mlm.rankAchievedAt)}</p>
            )}
          </section>

          <div className="rounded-2xl border border-primary/10 bg-primary/5 p-4 text-sm text-slate-600">
            <Network className="mr-1.5 inline h-4 w-4 text-primary" />
            Share your referral code to earn bonuses when friends join and contribute.
          </div>
        </div>
      </div>
    </div>
  );
}