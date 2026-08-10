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
              { icon: Award, label: 'Current rank', value: RANK_LABELS[overview.currentRank] ?? overview.currentRank, accent: 'text-neon' },
              { icon: Users, label: 'Direct referrals', value: overview.directCount, accent: 'text-primary' },
              { icon: Network, label: 'Total downline', value: overview.totalDownline, accent: 'text-primary' },
              { icon: Wallet, label: 'Bonuses earned', value: naira(overview.totalBonusEarned), accent: 'text-emerald-600' },
            ].map((stat) => (
              <div key={stat.label} className="card-light p-6">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                  <stat.icon className={`h-4 w-4 ${stat.accent}`} />
                  {stat.label}
                </div>
                <p className="mt-2 text-2xl font-extrabold text-slate-900">{stat.value}</p>
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
              <GlassCard>
                <div className="mb-4 flex items-center gap-2">
                  <Crown className="h-5 w-5 text-neon" />
                  <h3 className="text-lg font-bold text-white">Basic Plan</h3>
                </div>
                <ul className="space-y-2 text-sm text-white/70">
                  <li>Earn on 3 levels of your activation tree:</li>
                  <li className="flex justify-between rounded-xl bg-white/5 px-4 py-2">
                    <span>Level 1</span><span className="font-bold text-neon">₦500</span>
                  </li>
                  <li className="flex justify-between rounded-xl bg-white/5 px-4 py-2">
                    <span>Level 2</span><span className="font-bold text-neon">₦200</span>
                  </li>
                  <li className="flex justify-between rounded-xl bg-white/5 px-4 py-2">
                    <span>Level 3</span><span className="font-bold text-neon">₦100</span>
                  </li>
                  <li className="pt-2 text-xs text-white/40">
                    Bonus is paid when each downline activates their account.
                  </li>
                </ul>
              </GlassCard>
            </Reveal>

            <Reveal delay={120}>
              <GlassCard glow="neon">
                <div className="mb-4 flex items-center gap-2">
                  <Crown className="h-5 w-5 text-neon" />
                  <h3 className="text-lg font-bold text-white">Pro Plan</h3>
                  <span className="rounded-full bg-neon/15 px-3 py-1 text-xs font-bold text-neon">
                    Director+
                  </span>
                </div>
                <p className="mb-4 text-sm text-white/60">
                  Unlocked automatically at <span className="font-semibold text-white">Director</span>{' '}
                  rank (15 direct referrals). All bonuses boosted by 30%.
                </p>
                <ul className="space-y-2 text-sm text-white/70">
                  <li className="flex justify-between rounded-xl bg-white/5 px-4 py-2">
                    <span>Level 1</span><span className="font-bold text-neon">₦650</span>
                  </li>
                  <li className="flex justify-between rounded-xl bg-white/5 px-4 py-2">
                    <span>Level 2</span><span className="font-bold text-neon">₦260</span>
                  </li>
                  <li className="flex justify-between rounded-xl bg-white/5 px-4 py-2">
                    <span>Level 3</span><span className="font-bold text-neon">₦130</span>
                  </li>
                </ul>
              </GlassCard>
            </Reveal>
          </div>

          <Reveal>
            <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-6">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-bold text-slate-900">Rank ladder</h3>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Based on direct activated referrals
                {overview.rankAchievedAt
                  ? ` · Current rank achieved ${formatDate(overview.rankAchievedAt)}`
                  : ''}
              </p>
              <div className="mt-5 flex flex-col gap-3">
                {RANK_LADDER.map((rank, index) => {
                  const isCurrent = rank.key === overview.currentRank;
                  const achieved = index <= RANK_LADDER.findIndex((r) => r.key === overview.currentRank);
                  return (
                    <div
                      key={rank.key}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-all ${
                        isCurrent
                          ? 'border-primary bg-primary/5 shadow-glow'
                          : achieved
                            ? 'border-emerald-200 bg-emerald-50/60'
                            : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`h-2.5 w-2.5 rounded-full ${achieved ? 'bg-neon' : 'bg-slate-300'}`} />
                        <span className={isCurrent ? 'font-bold text-primary' : 'font-medium text-slate-700'}>
                          {rank.label}
                        </span>
                        {isCurrent && (
                          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-white">
                            Current
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-slate-400">{rank.minDirect}+ direct</span>
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
                  <table className="w-full text-left text-sm">
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
                          <td className="px-5 py-3">
                            <p className="font-medium text-slate-800">{member.fullName}</p>
                            <p className="text-xs text-slate-400">{member.email}</p>
                          </td>
                          <td className="px-5 py-3 text-slate-600">Level {member.level}</td>
                          <td className="px-5 py-3">
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
                          <td className="px-5 py-3 text-slate-600">{formatDate(member.joinedAt)}</td>
                          <td className="px-5 py-3 font-semibold text-emerald-600">
                            {naira(member.bonusEarned)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Reveal>
        </>
      )}
    </div>
  );
}
