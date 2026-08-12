export function StatusBadge({ status }) {
  const styles = {
    active: 'bg-emerald-50 text-emerald-600',
    suspended: 'bg-red-50 text-red-600',
    pending: 'bg-amber-50 text-amber-600',
    completed: 'bg-emerald-50 text-emerald-600',
    verified: 'bg-emerald-50 text-emerald-600',
    failed: 'bg-red-50 text-red-600',
    success: 'bg-emerald-50 text-emerald-600',
    cancelled: 'bg-slate-100 text-slate-500',
  };
  const label = typeof status === 'string' ? status.replace(/_/g, ' ') : String(status ?? '');
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
        styles[label] ?? 'bg-slate-100 text-slate-500'
      }`}
    >
      {label}
    </span>
  );
}

export function TxTypeBadge({ type }) {
  const styles = {
    deposit: 'bg-sky-50 text-sky-600',
    contribution: 'bg-violet-50 text-violet-600',
    bonus: 'bg-emerald-50 text-emerald-600',
    withdrawal: 'bg-red-50 text-red-600',
    adjustment: 'bg-amber-50 text-amber-600',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${styles[type] ?? 'bg-slate-100 text-slate-500'}`}>
      {type ?? '—'}
    </span>
  );
}
