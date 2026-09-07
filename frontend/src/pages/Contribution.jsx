import { useEffect, useState } from 'react';
import { PiggyBank, CalendarClock, CheckCircle2, Loader2, ShieldCheck, History, Users, Layers, Timer } from 'lucide-react';
import { api } from '../lib/api.js';
import { naira, formatDate } from '../lib/format.js';
import { payWithPaystack } from '../lib/paystack.js';
import Reveal from '../components/Reveal.jsx';

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

export default function Contribution() {
  const [plans, setPlans] = useState([]);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [changingPlan, setChangingPlan] = useState(false);

  const loadOverview = async () => {
    const data = await api('/contributions/overview');
    setOverview(data);
    return data;
  };

  useEffect(() => {
    api('/contributions/plans')
      .then((data) => setPlans(data.plans))
      .catch((err) => setError(err.message ?? 'Could not load plans'));

    loadOverview().catch((err) => setError(err.message ?? 'Could not load subscription'));
  }, []);

  const subscribe = async (planId) => {
    setError('');
    setInfo('Joining your AJO cohort...');
    setBusy(true);
    try {
      await api('/contributions/subscribe', { method: 'POST', body: { planId } });
      setInfo('You joined a weekly AJO cohort. Your first contribution is due now.');
      await loadOverview();
    } catch (err) {
      setError(err.message ?? 'Could not subscribe');
    } finally {
      setBusy(false);
    }
  };

  const changePlan = async (planId) => {
    setError('');
    setInfo('Switching your plan...');
    setBusy(true);
    try {
      await api('/contributions/plan', { method: 'PATCH', body: { planId } });
      setInfo('Plan updated successfully.');
      setChangingPlan(false);
      await loadOverview();
    } catch (err) {
      setError(err.message ?? 'Could not change plan');
    } finally {
      setBusy(false);
    }
  };

  const payNow = async () => {
    const subscriptionId = overview?.subscription?.id;
    if (!subscriptionId) return;

    setError('');
    setInfo('');
    setBusy(true);

    try {
      if (!PAYSTACK_PUBLIC_KEY) {
        throw new Error('Paystack public key is not configured');
      }

      const init = await api('/contributions/pay', { method: 'POST', body: { subscriptionId } });

      const weekLabel = init.weekIndex ? `week ${init.weekIndex}` : 'this week';

      await payWithPaystack({
        key: PAYSTACK_PUBLIC_KEY,
        email: init.email,
        amountKobo: init.amount,
        reference: init.reference,
        metadata: {
          custom_fields: [{ display_name: 'Contribution', variable_name: 'purpose', value: `Weekly AJO contribution (${weekLabel})` }],
        },
        onSuccess: async (reference) => {
          try {
            setInfo('Payment received. Verifying with Paystack...');
            const result = await api('/payments/verify', { method: 'POST', body: { reference } });
            if (result.verified) {
              setInfo(`Payment verified for ${weekLabel}. Thanks for contributing!`);
              await loadOverview();
            } else {
              setError('We could not confirm your payment. Please try again.');
            }
          } catch (err) {
            setError(err.message ?? 'Verification failed. Please try again.');
          } finally {
            setBusy(false);
          }
        },
        onCancel: () => {
          setInfo('');
          setBusy(false);
        },
      });
    } catch (err) {
      setError(err.message ?? 'Could not start payment. Please try again.');
      setBusy(false);
    }
  };

  const subscription = overview?.subscription;
  const cohort = overview?.cohort;
  const progressPercent = Math.round((overview?.progress ?? 0) * 100);
  const weeksPaid = overview?.weeksPaid ?? 0;

  return (
    <div className="container-lp pt-28 pb-16">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">AJO Contribution Platform</span>
        <h1 className="section-title text-slate-900">Weekly AJO savings</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Pick a weekly plan, contribute every week, and collect the pool when it is your turn.
          Each cohort has {overview?.cohort?.size ?? 52} positions and runs a 52-week cycle.
        </p>
      </div>

      {error && (
        <div className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</div>
      )}
      {info && (
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          <Loader2 className="h-4 w-4 animate-spin" />
          {info}
        </div>
      )}

      {changingPlan && (
        <div className="mt-8 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Choose your new plan</h3>
            <button
              onClick={() => setChangingPlan(false)}
              className="text-sm font-semibold text-primary hover:underline"
            >
              Cancel
            </button>
          </div>
          <p className="text-sm text-slate-500">
            Your payment history and progress are kept — only the weekly amount changes.
          </p>
        </div>
      )}

      {(!subscription || changingPlan) && (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <Reveal key={plan.id} delay={index * 120}>
              <div className="card-light h-full p-6 transition-all duration-300 hover:-translate-y-1.5 sm:p-8 hover:shadow-glow">
                <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <PiggyBank className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                <p className="mt-3 text-3xl font-extrabold text-slate-900">
                  {naira(plan.weeklyAmount)}
                  <span className="text-sm font-medium text-slate-400">/week</span>
                </p>
                <p className="mt-3 text-sm text-slate-500">
                  {naira((plan.weeklyAmount ?? 0) * (plan.cycleWeeks ?? 52))} over a{' '}
                  {plan.cycleWeeks ?? 52}-week cycle
                </p>
                {subscription ? (
                  <button
                    onClick={() => changePlan(plan.id)}
                    disabled={busy || subscription.plan.id === plan.id}
                    className={`mt-6 w-full ${subscription.plan.id === plan.id ? 'btn-ghost' : 'btn-primary'}`}
                  >
                    {subscription.plan.id === plan.id
                      ? 'Current plan'
                      : busy
                        ? 'Switching...'
                        : 'Switch to this plan'}
                  </button>
                ) : (
                  <button
                    onClick={() => subscribe(plan.id)}
                    disabled={busy}
                    className="mt-6 w-full btn-primary"
                  >
                    {busy ? 'Setting up...' : 'Join a cohort'}
                  </button>
                )}
              </div>
            </Reveal>
          ))}
        </div>
      )}

      {subscription && (
        <>
          <div className="card-light mt-8 p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">{subscription.plan.name}</h3>
                <p className="text-sm text-slate-500">
                  {naira(subscription.plan.weeklyAmount)} per week · {subscription.plan.cycleWeeks ?? 52}-week cycle
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {cohort && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                    <Users className="h-3.5 w-3.5" /> {cohort.name}
                  </span>
                )}
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {subscription.status}
                </span>
              </div>
            </div>

            {cohort && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Layers className="h-4 w-4 text-primary" /> My position
                  </div>
                  <p className="mt-2 text-2xl font-extrabold text-slate-900">
                    #{cohort.position ?? '—'}
                    <span className="text-sm font-medium text-slate-400"> of {cohort.size}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-500">You collect the pool on your position&apos;s week.</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    <Timer className="h-4 w-4 text-primary" /> Current week
                  </div>
                  <p className="mt-2 text-2xl font-extrabold text-slate-900">
                    {cohort.currentWeek}/{cohort.size}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {cohort.status === 'ACTIVE'
                      ? cohort.weeksLeftToCollect === 0
                        ? 'This is your collection week!'
                        : `${cohort.weeksLeftToCollect} week${cohort.weeksLeftToCollect === 1 ? '' : 's'} until collection`
                      : cohort.status === 'COMPLETED'
                        ? 'This cycle has completed.'
                        : 'Cohort is still filling up.'}
                  </p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 sm:col-span-2">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Expected payout (full pot)
                  </div>
                  <p className="mt-2 text-2xl font-extrabold text-emerald-600">
                    {naira(cohort.expectedPayout?.net ?? 0)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    From {naira(cohort.expectedPayout?.gross ?? 0)} collected, minus{' '}
                    {overview?.platformFeePercent ?? 2}% platform fee (
                    {naira(cohort.expectedPayout?.platformFee ?? 0)}). Actual payout depends on how many members
                    contribute that week.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
              <CalendarClock className="h-4 w-4 text-primary" />
              Next contribution due:{' '}
              <span className="font-semibold text-slate-800">{formatDate(subscription.nextPaymentDate)}</span>
              {cohort?.position === cohort?.currentWeek && cohort?.status === 'ACTIVE' && (
                <span className="ml-2 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">
                  Collection week {cohort.position}
                </span>
              )}
            </div>

            <button onClick={payNow} disabled={busy} className="btn-primary mt-6 w-full sm:w-auto">
              {busy ? 'Processing...' : `Pay ${naira(subscription.plan.weeklyAmount)} now`}
            </button>
            <button
              onClick={() => setChangingPlan(true)}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary hover:text-primary sm:w-auto"
            >
              Change plan
            </button>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              Secured by Paystack · A 2% platform fee applies to the weekly pool.
            </p>
          </div>

          <div className="card-light mt-6 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">52-week cycle progress</h3>
              <span className="text-sm font-semibold text-primary">
                {weeksPaid}/{overview?.cycleWeeks ?? 52} weeks
              </span>
            </div>
            <div className="mt-4 h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-neon transition-all duration-700"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>{progressPercent}% of cycle</span>
              <span>{naira(overview?.totalContributed ?? 0)} contributed</span>
            </div>
          </div>

          <div className="mt-8">
            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
              <History className="h-5 w-5 text-primary" /> Contribution history
            </h3>
            {overview?.history?.length === 0 ? (
              <div className="card-light mt-4 p-8 text-center text-sm text-slate-500">
                No contributions yet. Make your first payment above.
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                        <th className="px-5 py-3">Week</th>
                        <th className="px-5 py-3">Reference</th>
                        <th className="px-5 py-3">Amount</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview?.history?.map((payment) => (
                        <tr key={payment.id} className="border-b border-slate-50 last:border-0">
                          <td className="px-5 py-3 font-semibold text-slate-800">
                            {payment.weekIndex ? `#${payment.weekIndex}` : '—'}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-500">{payment.reference}</td>
                          <td className="px-5 py-3 font-semibold text-slate-800">{naira(payment.amount)}</td>
                          <td className="px-5 py-3">
                            {payment.status === 'verified' ? (
                              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">
                                Verified
                              </span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
                                {payment.status}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-slate-600">{formatDate(payment.paidAt ?? payment.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}