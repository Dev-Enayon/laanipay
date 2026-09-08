import { useEffect, useState } from 'react';
import {
  PiggyBank,
  CalendarClock,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  History,
  Users,
  Layers,
  Timer,
  CalendarDays,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { naira, formatDate } from '../lib/format.js';
import { payWithPaystack } from '../lib/paystack.js';
import { FREQUENCIES, frequencyLabel, periodSuffix } from '../lib/plans.js';
import Reveal from '../components/Reveal.jsx';

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

const CYCLE_WEEKS = 52;

export default function Contribution() {
  const [plans, setPlans] = useState([]);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPlans, setShowPlans] = useState(false);
  const [freq, setFreq] = useState('WEEKLY');

  const loadOverview = async () => {
    const data = await api('/contributions/overview');
    setOverview(data);
    return data;
  };

  useEffect(() => {
    api('/contributions/plans')
      .then((data) => setPlans(data.plans ?? []))
      .catch((err) => setError(err.message ?? 'Could not load plans'));

    loadOverview().catch((err) => setError(err.message ?? 'Could not load subscription'));
  }, []);

  const subscribe = async (planId) => {
    setError('');
    setInfo('Setting up your contribution plan...');
    setBusy(true);
    try {
      const result = await api('/contributions/subscribe', { method: 'POST', body: { planId } });
      setInfo(
        result.subscription?.plan?.frequency === 'WEEKLY'
          ? 'You joined a weekly AJO cohort. Your first contribution is due now.'
          : 'Your monthly contribution plan is active. Your first payment is due now.',
      );
      setShowPlans(false);
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
      setShowPlans(false);
      await loadOverview();
    } catch (err) {
      setError(err.message ?? 'Could not change plan');
    } finally {
      setBusy(false);
    }
  };

  const payNow = async (subscription) => {
    const subscriptionId = subscription?.id;
    if (!subscriptionId) return;

    setError('');
    setInfo('');
    setBusy(true);

    const weekly = subscription.plan?.frequency === 'WEEKLY';

    try {
      if (!PAYSTACK_PUBLIC_KEY) {
        throw new Error('Paystack public key is not configured');
      }

      const init = await api('/contributions/pay', { method: 'POST', body: { subscriptionId } });

      const weekLabel = weekly ? (init.weekIndex ? `week ${init.weekIndex}` : 'this week') : null;
      const purpose = weekly ? `Weekly AJO contribution (${weekLabel})` : 'Monthly contribution';

      await payWithPaystack({
        key: PAYSTACK_PUBLIC_KEY,
        email: init.email,
        amountKobo: init.amount,
        reference: init.reference,
        metadata: {
          custom_fields: [{ display_name: 'Contribution', variable_name: 'purpose', value: purpose }],
        },
        onSuccess: async (reference) => {
          try {
            setInfo('Payment received. Verifying with Paystack...');
            const result = await api('/payments/verify', { method: 'POST', body: { reference } });
            if (result.verified) {
              setInfo(
                weekly ? `Payment verified for ${weekLabel}. Thanks for contributing!` : 'Payment verified. Thanks for contributing!',
              );
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

  const subscriptions = overview?.subscriptions ?? [];
  const activeSub = subscriptions.find((s) => s.plan?.frequency === freq) ?? null;
  const has = (f) => subscriptions.some((s) => s.plan?.frequency === f);
  const bothFrequencies = has('MONTHLY') && has('WEEKLY');
  const plansForFreq = plans.filter((p) => p.frequency === freq);

  return (
    <div className="container-lp pt-28 pb-16">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Contribution Platform</span>
        <h1 className="section-title text-slate-900">Monthly &amp; weekly savings</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Save on your own schedule. Monthly plans charge your chosen amount every month. Weekly plans join a 52-member
          AJO cohort so you contribute weekly and collect the pool when it is your turn.
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

      <div className="mt-8 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-white p-1.5 shadow-card">
        {FREQUENCIES.map((f) => (
          <button
            key={f}
            onClick={() => setFreq(f)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-all ${
              freq === f ? 'bg-gradient-to-r from-primary to-neon text-white shadow-glow' : 'text-slate-500 hover:text-primary'
            }`}
          >
            {f === 'MONTHLY' ? <CalendarDays className="h-4 w-4" /> : <Users className="h-4 w-4" />}
            {frequencyLabel(f)}
            {has(f) && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${freq === f ? 'bg-white/20 text-white' : 'bg-emerald-50 text-emerald-600'}`}>
                Active
              </span>
            )}
          </button>
        ))}
      </div>

      {bothFrequencies && (
        <p className="mt-3 text-xs font-medium text-slate-500">
          You have both a monthly and a weekly contribution plan — use the tabs above to manage each independently.
        </p>
      )}

      {!activeSub || showPlans ? (
        <div className="mt-8">
          <div className="flex flex-col gap-2">
            <h3 className="text-lg font-bold text-slate-900">
              {freq === 'MONTHLY' ? 'Pick a monthly plan' : 'Pick a weekly plan'}
            </h3>
            <p className="text-sm text-slate-500">
              {freq === 'MONTHLY'
                ? 'Contribute a fixed amount every month. Simple, predictable savings.'
                : 'Contribute every week, collect the pool when it is your turn. Each cohort has 52 positions and runs a 52-week cycle.'}
            </p>
            {activeSub && showPlans && (
              <button onClick={() => setShowPlans(false)} className="w-fit text-sm font-semibold text-primary hover:underline">
                Cancel — keep {activeSub.plan.name}
              </button>
            )}
          </div>

          {plansForFreq.length === 0 ? (
            <div className="card-light mt-6 p-8 text-center text-sm text-slate-500">No plans available.</div>
          ) : (
            <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {plansForFreq.map((plan, index) => (
                <Reveal key={plan.id} delay={index * 120}>
                  <div className="card-light h-full p-6 transition-all duration-300 hover:-translate-y-1.5 sm:p-8 hover:shadow-glow">
                    <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                      <PiggyBank className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                    <p className="mt-3 text-3xl font-extrabold text-slate-900">
                      {naira(plan.amount)}
                      <span className="text-sm font-medium text-slate-400">{plan.periodSuffix ?? periodSuffix(plan.frequency)}</span>
                    </p>
                    <p className="mt-3 text-sm text-slate-500">
                      {plan.frequency === 'WEEKLY'
                        ? `${naira((plan.amount ?? 0) * (plan.cycleWeeks ?? CYCLE_WEEKS))} over a ${plan.cycleWeeks ?? CYCLE_WEEKS}-week cycle`
                        : 'Recurring monthly — your next payment is due one month after you subscribe.'}
                    </p>
                    {activeSub ? (
                      <button
                        onClick={() => changePlan(plan.id)}
                        disabled={busy || activeSub.plan.id === plan.id}
                        className={`mt-6 w-full ${activeSub.plan.id === plan.id ? 'btn-ghost' : 'btn-primary'}`}
                      >
                        {activeSub.plan.id === plan.id ? 'Current plan' : busy ? 'Switching...' : 'Switch to this plan'}
                      </button>
                    ) : (
                      <button onClick={() => subscribe(plan.id)} disabled={busy} className="mt-6 w-full btn-primary">
                        {busy ? 'Setting up...' : plan.frequency === 'WEEKLY' ? 'Join a cohort' : 'Subscribe monthly'}
                      </button>
                    )}
                  </div>
                </Reveal>
              ))}
            </div>
          )}

          {activeSub && (
            <p className="mt-6 text-sm text-slate-500">
              Your {frequencyLabel(freq).toLowerCase()} payment history and progress are kept — only the{' '}
              {frequencyLabel(freq).toLowerCase()} amount changes.
            </p>
          )}
        </div>
      ) : (
        <SubscriptionCard
          subscription={activeSub}
          overviewUnit={overview}
          busy={busy}
          onPay={payNow}
          onShowPlans={() => setShowPlans(true)}
        />
      )}
    </div>
  );
}

function SubscriptionCard({ subscription, overviewUnit, busy, onPay, onShowPlans }) {
  const weekly = subscription.plan?.frequency === 'WEEKLY';
  const cohort = subscription.cohort ?? null;
  const progressPercent = Math.round((subscription.progress ?? 0) * 100);
  const planPot = (subscription.plan?.weeklyAmount ?? 0) * (subscription.plan?.cycleWeeks ?? CYCLE_WEEKS);

  return (
    <div className="mt-8">
      <div className="card-light p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-primary">
              {frequencyLabel(subscription.plan?.frequency)} contribution
            </span>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{subscription.plan?.name}</h3>
            <p className="text-sm text-slate-500">
              {naira(subscription.amount ?? subscription.plan?.amount ?? subscription.plan?.weeklyAmount ?? 0)}
              {subscription.plan?.periodSuffix ?? periodSuffix(subscription.plan?.frequency)} · {subscription.plan?.frequency === 'WEEKLY' ? `${subscription.plan?.cycleWeeks ?? CYCLE_WEEKS}-week cycle` : 'Monthly recurring plan'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {weekly && cohort && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                <Users className="h-3.5 w-3.5" /> {cohort.name}
              </span>
            )}
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> {subscription.status}
            </span>
          </div>
        </div>

        {weekly && cohort ? (
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
                {overviewUnit?.platformFeePercent ?? 2}% platform fee ({naira(cohort.expectedPayout?.platformFee ?? 0)}). Actual payout
                depends on how many members contribute that week.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <CalendarClock className="h-4 w-4 text-primary" /> Next payment
              </div>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">{formatDate(subscription.nextPaymentDate)}</p>
              <p className="mt-1 text-xs text-slate-500">Your next monthly contribution is due on this date.</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Payments made
              </div>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">
                {subscription.paymentsPaid ?? subscription.weeksPaid ?? 0}
              </p>
              <p className="mt-1 text-xs text-slate-500">Verified monthly contributions to date.</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Total contributed
              </div>
              <p className="mt-2 text-2xl font-extrabold text-emerald-600">{naira(subscription.totalContributed ?? 0)}</p>
              <p className="mt-1 text-xs text-slate-500">Sum of all verified monthly contributions.</p>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
          <CalendarClock className="h-4 w-4 text-primary" />
          Next contribution due: <span className="font-semibold text-slate-800">{formatDate(subscription.nextPaymentDate)}</span>
          {weekly && cohort?.position === cohort?.currentWeek && cohort?.status === 'ACTIVE' && (
            <span className="ml-2 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-600">
              Collection week {cohort.position}
            </span>
          )}
        </div>

        <button onClick={() => onPay(subscription)} disabled={busy} className="btn-primary mt-6 w-full sm:w-auto">
          {busy ? 'Processing...' : `Pay ${naira(subscription.amount ?? subscription.plan?.amount ?? 0)} now`}
        </button>
        <button
          onClick={onShowPlans}
          className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary hover:text-primary sm:w-auto"
        >
          Change plan
        </button>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Secured by Paystack · {weekly ? 'A 2% platform fee applies to the weekly pool.' : 'No platform fee is charged on monthly contributions.'}
        </p>
      </div>

      {weekly ? (
        <div className="card-light mt-6 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">52-week cycle progress</h3>
            <span className="text-sm font-semibold text-primary">
              {(subscription.weeksPaid ?? 0)}/{overviewUnit?.cycleWeeks ?? CYCLE_WEEKS} weeks · saving {naira(planPot)}
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
            <span>{naira(subscription.totalContributed ?? 0)} contributed</span>
          </div>
        </div>
      ) : (
        <div className="card-light mt-6 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">Monthly contributions</h3>
            <span className="text-sm font-semibold text-primary">
              {(subscription.paymentsPaid ?? 0)} payment{(subscription.paymentsPaid ?? 0) === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            You contribute {naira(subscription.amount ?? subscription.plan?.amount ?? 0)} every month. Your payment history is below.
          </p>
        </div>
      )}

      <HistoryBlock subscription={subscription} />
    </div>
  );
}

function HistoryBlock({ subscription }) {
  const weekly = subscription.plan?.frequency === 'WEEKLY';
  return (
    <div className="mt-8">
      <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
        <History className="h-5 w-5 text-primary" /> {weekly ? 'Weekly contribution history' : 'Monthly contribution history'}
      </h3>
      {!subscription.history || subscription.history.length === 0 ? (
        <div className="card-light mt-4 p-8 text-center text-sm text-slate-500">
          No contributions yet. Make your first payment above.
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs uppercase tracking-wider text-slate-400">
                  <th className="px-5 py-3">{weekly ? 'Week' : 'Period'}</th>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {subscription.history.map((payment) => (
                  <tr key={payment.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-5 py-3 font-semibold text-slate-800">
                      {weekly ? (payment.weekIndex ? `#${payment.weekIndex}` : '—') : (payment.weekIndex ? `#${payment.weekIndex}` : '—')}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{payment.reference}</td>
                    <td className="px-5 py-3 font-semibold text-slate-800">{naira(payment.amount)}</td>
                    <td className="px-5 py-3">
                      {payment.status === 'verified' ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-600">Verified</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">{payment.status}</span>
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
  );
}