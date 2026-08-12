import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { nairaCompact } from '../../lib/format.js';

const COLORS = {
  users: '#0050ff',
  contributions: '#00a3ff',
  deposits: '#10b981',
  withdrawals: '#f43f5e',
  revenue: '#0050ff',
  profit: '#00ff88',
  mlmPayouts: '#f59e0b',
  walletBalance: '#8b5cf6',
};

export function chartData(points, formatter) {
  return (points ?? []).map((p) => ({ name: p.date, value: p.value, formatted: formatter ? formatter(p.value) : p.value }));
}

function formatValue(v, unit) {
  return unit === 'count' ? Number(v).toLocaleString() : nairaCompact(v);
}

function AxisTooltip({ unit }) {
  return <Tooltip formatter={(value) => [formatValue(value, unit), '']} />;
}

export function AreaSeries({ data, color, dataKey = 'value', height = 220, unit = 'money' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={24} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={(v) => formatValue(v, unit)} width={72} />
        <AxisTooltip unit={unit} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2.5} fill={`url(#grad-${color})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ChartCard({ title, subtitle, color, children }) {
  return (
    <div className="card-light p-5">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export const CHART_COLORS = COLORS;
