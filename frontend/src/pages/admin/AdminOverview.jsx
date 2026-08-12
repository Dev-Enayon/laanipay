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
    return <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>;
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
    { icon: Users, label: 'Total Registered Users', value: s.totalRegistered, accent: 'text-primary', bg: 'bg-primary/10' },
    { icon: UserCheck, label: 'Active Users', value: s.activeUsers, accent: 'text-emerald-600', bg: 'bg-emerald-50' },
    { icon: UserX, label: 'Suspended Users', value: s.suspendedUsers, accent: 'text-red-600', bg: 'bg-red-50' },
    { icon: Wallet, label: 'Total Wallet Balance', value: naira(s.totalWalletBalance), accent: 'text-primary', bg: 'bg-primary/10' },
    { icon: PiggyBank, label: 'Total User Contributions', value: naira(s.totalUserContributions), accent: 'text-violet-600', bg: 'bg-violet-50' },
    { icon: TrendingUp, label: 'Total Company Revenue', value: naira(s.companyRevenue), accent: 'text-primary', bg: 'bg-primary/10' },
    { icon: BadgeDollarSign, label: 'Total Company Profit', value: naira(s.companyProfit), accent: 'text-emerald-600', bg: 'bg-emerald-50' },
    { icon: ArrowUpFromLine, label: 'Total Withdrawals', value: naira(s.totalWithdrawals), accent: 'text-red-600', bg: 'bg-red-50' },
    { icon: ArrowDownToLine, label: 'Total Deposits / Funding', value: naira(s.totalDeposits), accent: 'text-sky-600', bg: 'bg-sky-50' },
    { icon: Network, label: 'Total MLM Members', value: s.totalMlmMembers, accent: 'text-violet-600', bg: 'bg-violet-50' },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Platform statistics</h2>
          <p className="text-xs text-slate-400">Computed live from trusted database records</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                period === p ? 'bg-primary text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="card-light p-4">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${card.bg}`}>
              <card.icon className={`h-4 w-4 ${card.accent}`} />
            </div>
            <p className="mt-3 text-xl font-extrabold text-slate-900">{card.value}</p>
            <p className="mt-0.5 text-[11px] leading-tight text-slate-400">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
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
