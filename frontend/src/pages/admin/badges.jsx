export function StatusBadge({ status }) {
  const styles = {
    active: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
    suspended: 'bg-red-100 text-red-700 ring-red-300',
    pending: 'bg-amber-100 text-amber-800 ring-amber-300',
    completed: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
    verified: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
    failed: 'bg-red-100 text-red-700 ring-red-300',
    success: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
    cancelled: 'bg-slate-200 text-slate-700 ring-slate-300',
  };
  const label = typeof status === 'string' ? status.replace(/_/g, ' ') : String(status ?? '');
  const className = styles[label] ?? 'bg-slate-200 text-slate-700 ring-slate-300';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${className}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function TxTypeBadge({ type }) {
  const styles = {
    deposit: 'bg-sky-100 text-sky-800 ring-sky-300',
    contribution: 'bg-violet-100 text-violet-800 ring-violet-300',
    bonus: 'bg-emerald-100 text-emerald-800 ring-emerald-300',
    withdrawal: 'bg-red-100 text-red-700 ring-red-300',
    adjustment: 'bg-amber-100 text-amber-800 ring-amber-300',
  };
  const className = styles[type] ?? 'bg-slate-200 text-slate-700 ring-slate-300';
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${className}`}
    >
      {type ?? '—'}
    </span>
  );
}
