import { useEffect, useState } from 'react';
import {
  Users,
  UserCheck,
  UserX,
  Wallet,
  PiggyBank,
  TrendingUp,
  BadgeDollarSign,
  ArrowDownToLine,
  ArrowUpFromLine,
  Network,
  Loader2,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import { naira } from '../../lib/format.js';
import { AreaSeries, ChartCard, chartData, CHART_COLORS } from './AdminChart.jsx';

const PERIODS = ['today', '7d', '30d', '3m', '6m', '1y', 'all'];

const PERIOD_LABELS = {
  today: 'Today',
  '7d': '7 Days',
  '30d': '30 Days',
  '3m': '3 Months',
  '6m': '6 Months',
  '1y': '1 Year',
  all: 'All Time',
};

const CARD_STYLES = {
  totalRegistered: { icon: Users, accent: 'text-white', chip: 'from-blue-500 to-blue-700' },
  activeUsers: { icon: UserCheck, accent: 'text-white', chip: 'from-emerald-400 to-emerald-600' },
  suspendedUsers: { icon: UserX, accent: 'text-white', chip: 'from-red-400 to-red-600' },
  totalWalletBalance: { icon: Wallet, accent: 'text-white', chip: 'from-indigo-400 to-indigo-600' },
  totalUserContributions: { icon: PiggyBank, accent: 'text-white', chip: 'from-violet-400 to-violet-600' },
  companyRevenue: { icon: TrendingUp, accent: 'text-white', chip: 'from-blue-500 to-blue-700' },
  companyProfit: { icon: BadgeDollarSign, accent: 'text-white', chip: 'from-emerald-400 to-emerald-600' },
  totalWithdrawals: { icon: ArrowUpFromLine, accent: 'text-white', chip: 'from-red-400 to-red-600' },
  totalDeposits: { icon: ArrowDownToLine, accent: 'text-white', chip: 'from-sky-400 to-sky-600' },
  totalMlmMembers: { icon: Network, accent: 'text-white', chip: 'from-fuchsia-400 to-fuchsia-600' },
};

export default function AdminOverview() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setData(null);
    api(`/admin/stats?period=${period}`)
      .then((d) => active && setData(d))
      .catch((err) => active && setError(err.message ?? 'Could not load statistics'));
    return () => {
      active = false;
    };
  }, [period]);

  if (error) {
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>;
  }

  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const s = data.summary;
  const c = data.charts;

  const cards = [
    { key: 'totalRegistered', label: 'Total Registered Users', value: s.totalRegistered },
    { key: 'activeUsers', label: 'Active Users', value: s.activeUsers },
    { key: 'suspendedUsers', label: 'Suspended Users', value: s.suspendedUsers },
    { key: 'totalWalletBalance', label: 'Total Wallet Balance', value: naira(s.totalWalletBalance) },
    { key: 'totalUserContributions', label: 'Total User Contributions', value: naira(s.totalUserContributions) },
    { key: 'companyRevenue', label: 'Total Company Revenue', value: naira(s.companyRevenue) },
    { key: 'companyProfit', label: 'Total Company Profit', value: naira(s.companyProfit) },
    { key: 'totalWithdrawals', label: 'Total Withdrawals', value: naira(s.totalWithdrawals) },
    { key: 'totalDeposits', label: 'Total Deposits / Funding', value: naira(s.totalDeposits) },
    { key: 'totalMlmMembers', label: 'Total MLM Members', value: s.totalMlmMembers },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">Platform statistics</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">Computed live from trusted database records</p>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition-all duration-200 ${
                period === p ? 'bg-primary text-white shadow-glow' : 'text-slate-500 hover:bg-slate-100 hover:text-primary'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => {
          const style = CARD_STYLES[card.key];
          return (
            <div key={card.key} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card transition-all duration-300 hover:-translate-y-1 hover:shadow-glow">
              <div className={`inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br shadow-sm ${style.chip}`}>
                <style.icon className="h-5 w-5 text-white" />
              </div>
              <p className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900">{card.value}</p>
              <p className="mt-1 text-xs font-semibold leading-snug text-slate-500">{card.label}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <ChartCard title={c.users.label} color={CHART_COLORS.users}>
          <AreaSeries data={chartData(c.users.points)} color={CHART_COLORS.users} unit="count" />
        </ChartCard>
        <ChartCard title={c.contributions.label} color={CHART_COLORS.contributions}>
          <AreaSeries data={chartData(c.contributions.points)} color={CHART_COLORS.contributions} />
        </ChartCard>
        <ChartCard title="Deposits vs withdrawals" color={CHART_COLORS.deposits}>
          <div className="space-y-4">
            <AreaSeries data={chartData(c.deposits.points)} color={CHART_COLORS.deposits} height={160} />
            <AreaSeries data={chartData(c.withdrawals.points)} color={CHART_COLORS.withdrawals} height={160} />
          </div>
        </ChartCard>
        <ChartCard title={c.revenue.label} color={CHART_COLORS.revenue}>
          <AreaSeries data={chartData(c.revenue.points)} color={CHART_COLORS.revenue} />
        </ChartCard>
        <ChartCard title={c.profit.label} color={CHART_COLORS.profit}>
          <AreaSeries data={chartData(c.profit.points)} color={CHART_COLORS.profit} />
        </ChartCard>
        <ChartCard title={c.mlmPayouts.label} color={CHART_COLORS.mlmPayouts}>
          <AreaSeries data={chartData(c.mlmPayouts.points)} color={CHART_COLORS.mlmPayouts} />
        </ChartCard>
        <ChartCard title={c.walletBalanceGrowth.label} color={CHART_COLORS.walletBalance}>
          <AreaSeries data={chartData(c.walletBalanceGrowth.points)} color={CHART_COLORS.walletBalance} />
        </ChartCard>
      </div>
    </div>
  );
}
