import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Network, PiggyBank, Wallet, Share2, Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';
import { naira, initials, formatDate } from '../lib/format.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);

  useEffect(() => {
    api('/wallet')
      .then((data) => setWallet(data))
      .catch(() => setWallet({ balance: 0 }));
  }, []);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

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
        </div>

        <div className="relative mt-8 grid gap-4 sm:grid-cols-2">
          <Link to="/wallet" className="group rounded-2xl border border-slate-100 bg-white p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-glow">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              <Wallet className="h-4 w-4 text-primary" /> Wallet balance
            </div>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">
              {naira(wallet?.balance ?? 0)}
            </p>
            <p className="mt-1 flex items-center justify-between text-xs text-slate-400">
              <span>MLM referral earnings</span>
              <span className="font-semibold text-emerald-600">
                {naira(wallet?.totalContributed ?? 0)} contributed
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
            <p className="mt-2 font-mono text-2xl font-extrabold tracking-wider text-primary">
              {user?.referralCode?.slice(0, 8)}
            </p>
            <p className="mt-1 text-xs text-slate-400">Share it with friends to start earning</p>
          </div>
        </div>
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
