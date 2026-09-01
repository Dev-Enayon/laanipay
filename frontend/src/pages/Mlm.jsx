import { useEffect, useState } from 'react';
import { Copy, Check, Crown, Users, Network, Wallet, CalendarClock, TrendingUp, Award } from 'lucide-react';
import { api } from '../lib/api.js';
import { naira, formatDate } from '../lib/format.js';
import GlassCard from '../components/GlassCard.jsx';
import Reveal from '../components/Reveal.jsx';

const RANK_LADDER = [
  { key: 'marketer', label: 'Marketer', minDirect: 1 },
  { key: 'manager', label: 'Manager', minDirect: 5 },
  { key: 'director', label: 'Director', minDirect: 15 },
  { key: 'ruby_director', label: 'Ruby Director', minDirect: 30 },
  { key: 'diamond_director', label: 'Diamond Director', minDirect: 50 },
];

const RANK_LABELS = {
  marketer: 'Marketer',
  manager: 'Manager',
  director: 'Director',
  ruby_director: 'Ruby Director',
  diamond_director: 'Diamond Director',
};

const RANK_STYLE = {
  marketer: {
    gem: 'from-slate-200 to-slate-500 shadow-[0_0_14px_rgba(148,163,184,0.5)]',
    text: 'text-slate-100',
    chip: 'border-slate-400/30 text-slate-300',
  },
  manager: {
    gem: 'from-amber-200 to-amber-600 shadow-[0_0_14px_rgba(245,158,11,0.5)]',
    text: 'text-amber-200',
    chip: 'border-amber-400/30 text-amber-300',
  },
  director: {
    gem: 'from-yellow-100 to-yellow-500 shadow-[0_0_14px_rgba(250,204,21,0.55)]',
    text: 'text-yellow-300',
    chip: 'border-yellow-400/30 text-yellow-200',
  },
  ruby_director: {
    gem: 'from-rose-300 to-rose-600 shadow-[0_0_14px_rgba(244,63,94,0.55)]',
    text: 'text-rose-300',
    chip: 'border-rose-400/30 text-rose-300',
  },
  diamond_director: {
    gem: 'from-cyan-200 to-sky-500 shadow-[0_0_14px_rgba(103,232,249,0.55)]',
    text: 'text-cyan-200',
    chip: 'border-cyan-300/30 text-cyan-200',
  },
};

export default function Mlm() {
  const [overview, setOverview] = useState(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/mlm/overview')
      .then(setOverview)
      .catch((err) => setError(err.message ?? 'Could not load MLM overview'));
  }, []);

  const referralLink = overview
    ? `${window.location.origin}/signup?ref=${overview.referralCode}`
    : '';

  const currentIndex = overview
    ? RANK_LADDER.findIndex((r) => r.key === overview.currentRank)
    : -1;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy link');
    }
  };

  return (
    <div className="container-lp pt-28 pb-16">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">MLM Platform</span>
        <h1 className="section-title text-slate-900">Referral earning &amp; ranks</h1>
      </div>

      {error && (
        <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>
      )}

      {!overview && !error && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {overview && (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Award, label: 'Current rank', value: RANK_LABELS[overview.currentRank] ?? overview.currentRank, accent: 'text-neon', rank: true },
              { icon: Users, label: 'Direct referrals', value: overview.directCount, accent: 'text-sky-400', rank: false },
              { icon: Network, label: 'Total downline', value: overview.totalDownline, accent: 'text-violet-400', rank: false },
              { icon: Wallet, label: 'Bonuses earned', value: naira(overview.totalBonusEarned), accent: 'text-emerald-400', rank: false },
            ].map((stat) => (
              <div
                key={stat.label}
                className={`relative overflow-hidden rounded-2xl border p-6 text-white transition-all ${
                  stat.rank
                    ? 'border-neon/40 bg-gradient-to-br from-slate-900 via-ink to-emerald-950/40 shadow-neon'
                    : 'border-white/10 bg-gradient-to-br from-slate-900 to-ink'
                }`}
              >
                <div
                  className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl ${
                    stat.rank ? 'bg-neon/25' : 'bg-primary/25'
                  }`}
                />
                <div className="relative flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/50">
                  <stat.icon className={`h-4 w-4 ${stat.accent}`} />
                  {stat.label}
                </div>
                <p
                  className={`relative mt-2 font-display text-2xl font-bold tracking-tight ${
                    stat.rank ? 'bg-gradient-to-r from-neon to-emerald-300 bg-clip-text text-transparent' : 'text-white'
                  }`}
                >
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          <div className="card-light mt-6 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <TrendingUp className="h-4 w-4 text-primary" /> Your referral link
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <input
                readOnly
                value={referralLink}
                className="input flex-1 font-mono text-xs"
                onFocus={(event) => event.target.select()}
              />
              <button onClick={copyLink} className="btn-primary">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Reveal>
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-ink p-6 text-white">
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-slate-500/20 blur-3xl" />
                <div className="relative mb-4 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-500/20">
                    <Crown className="h-4 w-4 text-slate-300" />
                  </span>
                  <h3 className="font-display text-lg font-bold tracking-tight text-white">Basic Plan</h3>
                  <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/50">
                    All members
                  </span>
                </div>
                <p className="relative text-xs text-white/40">Earn on 3 levels of your activation tree:</p>
                <ul className="relative mt-3 space-y-2 text-sm">
                  <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
                    <span className="font-medium text-white/70">Level 1</span>
                    <span className="font-display text-base font-bold text-slate-100">₦500</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
                    <span className="font-medium text-white/70">Level 2</span>
                    <span className="font-display text-base font-bold text-slate-100">₦200</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
                    <span className="font-medium text-white/70">Level 3</span>
                    <span className="font-display text-base font-bold text-slate-100">₦100</span>
                  </li>
                </ul>
                <p className="relative mt-3 text-[11px] text-white/40">
                  Bonus is paid when each downline activates their account.
                </p>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <div className="relative overflow-hidden rounded-2xl border border-yellow-400/30 bg-gradient-to-br from-slate-900 via-ink to-amber-950/30 p-6 text-white shadow-[0_0_24px_rgba(250,204,21,0.15)]">
                <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-yellow-400/20 blur-3xl" />
                <div className="relative mb-4 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-400/15">
                    <Crown className="h-4 w-4 text-yellow-300" />
                  </span>
                  <h3 className="font-display text-lg font-bold tracking-tight text-white">Pro Plan</h3>
                  <span className="ml-auto rounded-full bg-gradient-to-r from-yellow-200 to-amber-500 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink">
                    Director+
                  </span>
                </div>
                <p className="relative text-xs text-white/50">
                  Unlocked automatically at{' '}
                  <span className="font-semibold text-yellow-300">Director</span> rank (15 direct
                  referrals). All bonuses boosted by 30%.
                </p>
                <ul className="relative mt-3 space-y-2 text-sm">
                  <li className="flex items-center justify-between rounded-xl border border-yellow-400/20 bg-white/5 px-4 py-2.5">
                    <span className="font-medium text-white/70">Level 1</span>
                    <span className="font-display text-base font-bold text-yellow-300">₦650</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl border border-yellow-400/20 bg-white/5 px-4 py-2.5">
                    <span className="font-medium text-white/70">Level 2</span>
                    <span className="font-display text-base font-bold text-yellow-300">₦260</span>
                  </li>
                  <li className="flex items-center justify-between rounded-xl border border-yellow-400/20 bg-white/5 px-4 py-2.5">
                    <span className="font-medium text-white/70">Level 3</span>
                    <span className="font-display text-base font-bold text-yellow-300">₦130</span>
                  </li>
                </ul>
              </div>
            </Reveal>
          </div>

          <Reveal>
            <div className="relative mt-6 overflow-hidden rounded-2xl bg-ink p-6 text-white md:p-8">
              <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-neon/10 blur-3xl" />

              <div className="relative flex flex-wrap items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neon/15">
                  <Award className="h-4 w-4 text-neon" />
                </span>
                <h3 className="font-display text-xl font-bold tracking-tight text-white">Rank ladder</h3>
                <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60">
                  {currentIndex + 1}/{RANK_LADDER.length} unlocked
                </span>
              </div>
              <p className="mt-2 text-xs text-white/40">
                Based on direct activated referrals
                {overview.rankAchievedAt
                  ? ` · Current rank achieved ${formatDate(overview.rankAchievedAt)}`
                  : ''}
              </p>

              <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-neon to-neon transition-all duration-700"
                  style={{ width: `${((currentIndex + 1) / RANK_LADDER.length) * 100}%` }}
                />
              </div>

              <div className="relative mt-6 flex flex-col gap-3">
                {RANK_LADDER.map((rank, index) => {
                  const isCurrent = rank.key === overview.currentRank;
                  const achieved = index <= currentIndex;
                  const tier = RANK_STYLE[rank.key];
                  return (
                    <div
                      key={rank.key}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3.5 transition-all sm:px-4 ${
                        isCurrent
                          ? 'border-neon/40 bg-white/10 shadow-neon'
                          : achieved
                            ? 'border-white/10 bg-white/5'
                            : 'border-white/5 bg-transparent'
                      }`}
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${
                            tier.gem
                          } ${achieved ? '' : 'opacity-30 grayscale'}`}
                        >
                          <Award className="h-4 w-4 text-ink" />
                        </span>
                        <div className="min-w-0">
                          <p className={`truncate font-display text-base font-semibold tracking-tight ${achieved ? tier.text : 'text-white/35'}`}>
                            {rank.label}
                          </p>
                          <p className="text-[11px] text-white/40">{rank.minDirect}+ direct activated</p>
                        </div>
                        {isCurrent && (
                          <span className="shrink-0 rounded-full bg-neon px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">
                            Current
                          </span>
                        )}
                      </div>
                      <span className={`shrink-0 text-xs font-semibold ${achieved ? `rounded-full border px-2.5 py-1 ${tier.chip}` : 'text-white/25'}`}>
                        {rank.minDirect}+ direct
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>

          <Reveal>
            <GlassCard className="mt-6 p-6">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-neon" />
                <h3 className="text-lg font-bold text-white">Monthly Verification Plan</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                To keep your earning status and rank progression active, maintain an active monthly
                contribution subscription on the Contribution Platform. Each month your account is
                verified automatically once your contribution payment succeeds — keeping your team
                bonuses flowing.
              </p>
            </GlassCard>
          </Reveal>

          <Reveal>
            <div className="mt-8">
              <h3 className="text-lg font-bold text-slate-900">Your downline</h3>
              {overview.downline.length === 0 ? (
                <div className="card-light mt-4 p-8 text-center text-sm text-slate-500">
                  No referrals yet. Share your link above and start building your team.
                </div>
              ) : (
                <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-white">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                        <th className="px-5 py-3">Member</th>
                        <th className="px-5 py-3">Level</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Joined</th>
                        <th className="px-5 py-3">Bonus</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.downline.map((member) => (
                    <tr key={member.id} className="border-b border-slate-50 last:border-0">
                      <td className="whitespace-nowrap px-5 py-3">
                        <p className="font-medium text-slate-800">{member.fullName}</p>
                        <p className="text-xs text-slate-400">{member.email}</p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">Level {member.level}</td>
                      <td className="whitespace-nowrap px-5 py-3">
                        {member.activationStatus ? (
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                            Pending activation
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(member.joinedAt)}</td>
                      <td className="whitespace-nowrap px-5 py-3 font-semibold text-emerald-600">
                        {naira(member.bonusEarned)}
                      </td>
                    </tr>
                  ))}
                    </tbody>
                  </table>
                  </div>
                </div>
              )}
            </div>
          </Reveal>
        </>
      )}
    </div>
  );
}
