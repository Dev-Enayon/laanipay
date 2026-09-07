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