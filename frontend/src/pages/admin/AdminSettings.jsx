import { useEffect, useState } from 'react';
import { Settings, Loader2, Save, ShieldCheck, Info } from 'lucide-react';
import { api } from '../../lib/api.js';

function nairaInput(kobo) {
  return String((kobo ?? 0) / 100);
}

export default function AdminSettings() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');

  const [form, setForm] = useState({
    registrationFee: '',
    monthlySubscriptionFee: '',
    cohortSize: '',
    mlmLevels: '',
    rewards: { REGISTRATION: { 1: '', 2: '', 3: '' }, MONTHLY_SUBSCRIPTION: { 1: '', 2: '', 3: '' } },
    bufferPolicy: { enabled: false, mode: 'percent', percent: '', flatKobo: '', protectPayouts: false, allowPartialProtection: false, mainPotFallback: false },
    defaultPolicy: { enabled: false, graceDays: '', closeOnDefault: false },
    finePolicy: { enabled: false, amountKobo: '', destination: 'unassigned' },
  });

  useEffect(() => {
    api('/admin/settings')
      .then((d) => {
        setData(d);
        const s = d.settings;
        setForm({
          registrationFee: nairaInput(s.registrationFeeKobo),
          monthlySubscriptionFee: nairaInput(s.monthlySubscriptionFeeKobo),
          cohortSize: String(s.cohortSize ?? ''),
          mlmLevels: String(s.mlmLevels ?? ''),
          rewards: {
            REGISTRATION: {
              1: String((s.rewards?.REGISTRATION?.[1] ?? 0) / 100),
              2: String((s.rewards?.REGISTRATION?.[2] ?? 0) / 100),
              3: String((s.rewards?.REGISTRATION?.[3] ?? 0) / 100),
            },
            MONTHLY_SUBSCRIPTION: {
              1: String((s.rewards?.MONTHLY_SUBSCRIPTION?.[1] ?? 0) / 100),
              2: String((s.rewards?.MONTHLY_SUBSCRIPTION?.[2] ?? 0) / 100),
              3: String((s.rewards?.MONTHLY_SUBSCRIPTION?.[3] ?? 0) / 100),
            },
          },
          bufferPolicy: {
            enabled: s.bufferPolicy?.enabled === true,
            mode: s.bufferPolicy?.mode === 'flat' ? 'flat' : 'percent',
            percent: String(s.bufferPolicy?.percent ?? 0),
            flatKobo: nairaInput(s.bufferPolicy?.flatKobo ?? 0),
            protectPayouts: s.bufferPolicy?.protectPayouts === true,
            allowPartialProtection: s.bufferPolicy?.allowPartialProtection === true,
            mainPotFallback: s.bufferPolicy?.mainPotFallback === true,
          },
          defaultPolicy: {
            enabled: s.defaultPolicy?.enabled === true,
            graceDays: String(s.defaultPolicy?.graceDays ?? 7),
            closeOnDefault: s.defaultPolicy?.closeOnDefault === true,
          },
          finePolicy: {
            enabled: s.finePolicy?.enabled === true,
            amountKobo: nairaInput(s.finePolicy?.amountKobo ?? 0),
            destination: s.finePolicy?.destination ?? 'unassigned',
          },
        });
      })
      .catch((err) => setError(err.message ?? 'Could not load settings'));
  }, []);

  const setReward = (type, level, v) => {
    setForm((f) => ({
      ...f,
      rewards: { ...f.rewards, [type]: { ...f.rewards[type], [level]: v } },
    }));
  };

  const field = 'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-800 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/10';

  const save = async () => {
    setSaving(true);
    setSaved('');
    setError('');
    const rewards = {
      REGISTRATION: {
        1: Math.round(Number(form.rewards.REGISTRATION[1] ?? 0) * 100),
        2: Math.round(Number(form.rewards.REGISTRATION[2] ?? 0) * 100),
        3: Math.round(Number(form.rewards.REGISTRATION[3] ?? 0) * 100),
      },
      MONTHLY_SUBSCRIPTION: {
        1: Math.round(Number(form.rewards.MONTHLY_SUBSCRIPTION[1] ?? 0) * 100),
        2: Math.round(Number(form.rewards.MONTHLY_SUBSCRIPTION[2] ?? 0) * 100),
        3: Math.round(Number(form.rewards.MONTHLY_SUBSCRIPTION[3] ?? 0) * 100),
      },
    };
    try {
      const res = await api('/admin/settings', {
        method: 'PUT',
        body: {
          registrationFeeKobo: Math.round(Number(form.registrationFee) * 100),
          monthlySubscriptionFeeKobo: Math.round(Number(form.monthlySubscriptionFee) * 100),
          cohortSize: Number(form.cohortSize),
          mlmLevels: Number(form.mlmLevels),
          rewards,
          bufferPolicy: {
            enabled: form.bufferPolicy.enabled,
            mode: form.bufferPolicy.mode,
            percent: Number(form.bufferPolicy.percent),
            flatKobo: Math.round(Number(form.bufferPolicy.flatKobo) * 100),
            protectPayouts: form.bufferPolicy.protectPayouts,
            allowPartialProtection: form.bufferPolicy.allowPartialProtection,
            mainPotFallback: form.bufferPolicy.mainPotFallback,
          },
          defaultPolicy: {
            enabled: form.defaultPolicy.enabled,
            graceDays: Number(form.defaultPolicy.graceDays),
            closeOnDefault: form.defaultPolicy.closeOnDefault,
          },
          finePolicy: {
            enabled: form.finePolicy.enabled,
            amountKobo: Math.round(Number(form.finePolicy.amountKobo) * 100),
            destination: form.finePolicy.destination,
          },
        },
      });
      setSaved(`Saved: ${res.updated.join(', ')}. Settings are used from the next transaction onward.`);
    } catch (err) {
      setError(err.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!data && !error) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const feeNote = (kobo) => kobo === 0 ? 'Currently ₦0 — verification default' : '';

  return (
    <div>
      <div>
        <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-slate-900">
          <Settings className="h-5 w-5 text-primary" /> Platform settings
        </h2>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Stored in the database. Settings take effect on the next transaction and are never computed retroactively.
        </p>
      </div>

      {error && <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}
      {saved && <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{saved}</div>}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <h3 className="text-sm font-bold text-slate-900">Fees (₦)</h3>
          <p className="mt-1 text-xs text-slate-400">Stored in kobo; entered above as naira.</p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Account activation fee</label>
              <input
                type="number"
                min="0"
                step="50"
                value={form.registrationFee}
                onChange={(e) => setForm((f) => ({ ...f, registrationFee: e.target.value }))}
                className={field}
              />
              <p className="mt-1 text-[11px] text-slate-400">Paid once to activate earning. Rewards share this fee — they can never exceed it. Source of truth for the checkout page (falls back to env if never set).</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Monthly subscription fee</label>
              <input
                type="number"
                min="0"
                step="50"
                value={form.monthlySubscriptionFee}
                onChange={(e) => setForm((f) => ({ ...f, monthlySubscriptionFee: e.target.value }))}
                className={field}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                {feeNote(Math.round(Number(form.monthlySubscriptionFee ?? 0) * 100))}
                Recurs monthly: deducted from each member's wallet and shared as level 1–3 rewards.
                Source of truth for the service-charge job (falls back to env if never set).
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
          <h3 className="text-sm font-bold text-slate-900">AJO configuration</h3>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Cohort size</label>
              <input
                type="number"
                min="2"
                max="200"
                step="1"
                value={form.cohortSize}
                onChange={(e) => setForm((f) => ({ ...f, cohortSize: e.target.value }))}
                className={field}
              />
              <p className="mt-1 text-[11px] text-slate-400">Members per rotation pool (2–200). Applied to cohorts opened after saving.</p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">MLM levels</label>
              <input
                type="number"
                min="1"
                max="5"
                step="1"
                value={form.mlmLevels}
                onChange={(e) => setForm((f) => ({ ...f, mlmLevels: e.target.value }))}
                className={field}
              />
              <p className="mt-1 text-[11px] text-slate-400">How deep registration/subscription rewards are paid (1–5).</p>
            </div>
            <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs font-medium text-slate-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                Platform fee is the naira value displayed in each payout. It is controlled by the environment variable
                <code className="mx-1 rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[11px]">WEEKLY_PLATFORM_FEE_PERCENTAGE</code>
                {data.settings.envPlatformFeePercent ? (
                  <> (currently <strong>{data.settings.envPlatformFeePercent}%</strong>)</>
                ) : (
                  <> (unset — defaulting to <strong>2%</strong>)</>
                )}
                . It can never be changed from this panel.
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-900">Contribution security buffer (AJO)</h3>
          <p className="mt-1 text-xs text-slate-400">
            A configurable share of each verified weekly contribution is set aside in the group&apos;s buffer pool,
            tracked per member in an auditable ledger. Disabled by default — the entire contribution funds the main pot.
          </p>

          <div className="mt-4 space-y-4">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={form.bufferPolicy.enabled}
                onChange={(e) =>
                  setForm((f) => ({ ...f, bufferPolicy: { ...f.bufferPolicy, enabled: e.target.checked } }))
                }
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm font-semibold text-slate-800">Enable security buffer on weekly contributions</span>
            </label>

            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, bufferPolicy: { ...f.bufferPolicy, mode: 'percent' } }))}
                className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                  form.bufferPolicy.mode === 'percent' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Percent of payment
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, bufferPolicy: { ...f.bufferPolicy, mode: 'flat' } }))}
                className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                  form.bufferPolicy.mode === 'flat' ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Fixed amount
              </button>
            </div>

            {form.bufferPolicy.mode === 'percent' ? (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Buffer percent (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={form.bufferPolicy.percent}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bufferPolicy: { ...f.bufferPolicy, percent: e.target.value } }))
                  }
                  className={field}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Applied to each weekly contribution. E.g. 2% of a ₦5,000 week sets aside ₦100 in the buffer and funds
                  ₦4,900 to the main pot. Main + buffer always equal the exact payment.
                </p>
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Fixed buffer amount (₦)</label>
                <input
                  type="number"
                  min="0"
                  step="50"
                  value={form.bufferPolicy.flatKobo}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bufferPolicy: { ...f.bufferPolicy, flatKobo: e.target.value } }))
                  }
                  className={field}
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  A fixed naira amount diverted from each weekly contribution. Clamped so it can never exceed the contribution itself.
                </p>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs font-medium text-slate-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                Buffer money is protection for the group cycle and is never spendable wallet balance.
              </span>
            </div>

            <div className="space-y-2.5 border-t border-slate-100 pt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Payout protection (unresolved policy)</p>
              {[
                {
                  key: 'protectPayouts',
                  label: 'Advance the buffer to protect a week’s payout from defaulting members',
                  hint: 'When a member misses, the group pot shrinks. Enabling this advances buffer money to cover the shortfall, net of fees. Off means a miss simply reduces that week’s payout.',
                },
                {
                  key: 'allowPartialProtection',
                  label: 'Allow partial protection when the buffer cannot cover the full shortfall',
                  hint: 'Off (recommended) means an insufficient buffer writes no debit at all and records an unresolved shortfall for admin.',
                },
                {
                  key: 'mainPotFallback',
                  label: 'Allow the main contribution pot to absorb an unresolved shortfall',
                  hint: 'Off (recommended). Enabling this spends real contributions to cover a default, which has not been approved as a business rule.',
                },
              ].map((opt) => (
                <label key={opt.key} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={form.bufferPolicy[opt.key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, bufferPolicy: { ...f.bufferPolicy, [opt.key]: e.target.checked } }))
                    }
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span>
                    <span className="text-sm font-semibold text-slate-800">{opt.label}</span>
                    <span className="mt-0.5 block text-[11px] text-slate-400">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-900">Missed contribution, grace &amp; default</h3>
          <p className="mt-1 text-xs text-slate-400">
            When a weekly member misses a scheduled contribution, the miss is recorded, a grace period starts, the member is
            notified, and a recovery case is opened. The member is never removed during grace. Disabled by default.
          </p>

          <div className="mt-4 space-y-4">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={form.defaultPolicy.enabled}
                onChange={(e) =>
                  setForm((f) => ({ ...f, defaultPolicy: { ...f.defaultPolicy, enabled: e.target.checked } }))
                }
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm font-semibold text-slate-800">Enable missed-contribution tracking</span>
            </label>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Grace period (days)</label>
              <input
                type="number"
                min="0"
                max="90"
                step="1"
                value={form.defaultPolicy.graceDays}
                onChange={(e) => setForm((f) => ({ ...f, defaultPolicy: { ...f.defaultPolicy, graceDays: e.target.value } }))}
                className={field}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                A member who catches up within this window pays missed + current + any fine, and no default is recorded.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={form.defaultPolicy.closeOnDefault}
                onChange={(e) =>
                  setForm((f) => ({ ...f, defaultPolicy: { ...f.defaultPolicy, closeOnDefault: e.target.checked } }))
                }
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                <span className="text-sm font-semibold text-slate-800">Close participation when grace expires</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  Closes the membership only. Nothing is deleted — payments, buffer records, fines, debts and audit logs are
                  all preserved. No replacement member is inserted mid-cycle.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card lg:col-span-2">
          <h3 className="text-sm font-bold text-slate-900">Default fine</h3>
          <p className="mt-1 text-xs text-slate-400">
            A fine is recorded as its own financial event against the recovery case. It is only ever charged when enabled,
            and the amount is configured here — never hard-coded.
          </p>

          <div className="mt-4 space-y-4">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={form.finePolicy.enabled}
                onChange={(e) => setForm((f) => ({ ...f, finePolicy: { ...f.finePolicy, enabled: e.target.checked } }))}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm font-semibold text-slate-800">Charge a fine on default</span>
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Fine amount (₦)</label>
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={form.finePolicy.amountKobo}
                  onChange={(e) => setForm((f) => ({ ...f, finePolicy: { ...f.finePolicy, amountKobo: e.target.value } }))}
                  className={field}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Destination label</label>
                <input
                  type="text"
                  value={form.finePolicy.destination}
                  onChange={(e) => setForm((f) => ({ ...f, finePolicy: { ...f.finePolicy, destination: e.target.value } }))}
                  className={field}
                />
                <p className="mt-1 text-[11px] text-slate-400">A label only — no automatic transfer is performed.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
        <h3 className="text-sm font-bold text-slate-900">Referral rewards (₦)</h3>
        <p className="mt-1 text-xs text-slate-400">
          Rewards are validated so they never exceed the fee they share: registration rewards ≤ activation fee, subscription rewards ≤ monthly fee.
        </p>

        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {[
            { type: 'REGISTRATION', title: 'Registration rewards', hint: 'Paid once on referral activation' },
            { type: 'MONTHLY_SUBSCRIPTION', title: 'Monthly subscription rewards', hint: 'Paid monthly per active downline' },
          ].map((block) => (
            <div key={block.type} className="rounded-xl border border-slate-100 bg-slate-50/50 p-4">
              <h4 className="text-sm font-bold text-slate-800">{block.title}</h4>
              <p className="mt-0.5 text-[11px] text-slate-400">{block.hint}</p>
              <div className="mt-3 space-y-3">
                {[1, 2, 3].map((level) => (
                  <div key={level} className="flex items-center gap-3">
                    <span className="w-16 text-xs font-bold text-slate-500">Level {level}</span>
                    <div className="relative flex-1">
                      <input
                        type="number"
                        min="0"
                        step="10"
                        value={form.rewards[block.type][level]}
                        onChange={(e) => setReward(block.type, level, e.target.value)}
                        className={field}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        ₦
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <ShieldCheck className="h-4 w-4 text-primary" /> Changes are audit-logged.
        </span>
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-glow transition enabled:hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}