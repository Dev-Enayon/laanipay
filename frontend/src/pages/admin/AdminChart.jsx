import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { nairaCompact } from '../../lib/format.js';

const COLORS = {
  users: '#0050ff',
  contributions: '#00a3ff',
  deposits: '#10b981',
  withdrawals: '#e11d48',
  revenue: '#0050ff',
  profit: '#00b368',
  mlmPayouts: '#f59e0b',
  walletBalance: '#7c3aed',
};

export function chartData(points, formatter) {
  return (points ?? []).map((p) => ({ name: p.date, value: p.value, formatted: formatter ? formatter(p.value) : p.value }));
}

function formatValue(v, unit) {
  return unit === 'count' ? Number(v).toLocaleString() : nairaCompact(v);
}

function AxisTooltip({ unit }) {
  return (
    <Tooltip
      formatter={(value) => [formatValue(value, unit), '']}
      contentStyle={{
        borderRadius: 12,
        border: '1px solid #e2e8f0',
        boxShadow: '0 12px 30px rgba(2, 6, 23, 0.12)',
        fontSize: 13,
        fontWeight: 600,
      }}
    />
  );
}

export function AreaSeries({ data, color, dataKey = 'value', height = 220, unit = 'money' }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 13, fill: '#475569', fontWeight: 600 }} minTickGap={28} axisLine={{ stroke: '#cbd5e1' }} />
        <YAxis tick={{ fontSize: 13, fill: '#475569', fontWeight: 600 }} tickFormatter={(v) => formatValue(v, unit)} width={84} axisLine={{ stroke: '#cbd5e1' }} />
        <AxisTooltip unit={unit} />
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={3} fill={`url(#grad-${color})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ChartCard({ title, subtitle, color, children }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-card">
      <div className="mb-4 flex items-center gap-3">
        <span className="h-8 w-1.5 rounded-full" style={{ backgroundColor: color }} />
        <div>
          <h3 className="font-display text-base font-bold tracking-tight text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

export const CHART_COLORS = COLORS;
