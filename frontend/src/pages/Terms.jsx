import { Link } from 'react-router-dom';
import { ShieldCheck, FileText, AlertTriangle, Wallet, Coins, RefreshCcw } from 'lucide-react';

const sections = [
  {
    icon: ShieldCheck,
    title: '1. Nature of the Platform',
    body: 'LaaniPay is a community savings and referral programme. By joining you are participating in a cooperative weekly savings round (Ajo) and a rewards programme tied to activation and subscription fees. LaaniPay is not a bank, a deposit-taking institution, an investment, or a provider of guaranteed returns. We do not promise, imply or guarantee any income, profit or rate of return.',
  },
  {
    icon: Wallet,
    title: '2. Fees',
    body: 'A one-time account activation fee of ₦1,500 applies. A ₦300 membership subscription is deducted monthly from your wallet to keep your account and earning status active. Weekly contribution amounts are set by the plan you choose (₦1,000, ₦3,000 or ₦5,000 per week). A platform fee of up to 2% of each weekly pool is applied by us for operating the service. All fees are disclosed before you confirm any payment.',
  },
  {
    icon: RefreshCcw,
    title: '3. Weekly Savings Rounds (Ajo)',
    body: 'Each cohort is a fixed circle of members who contribute an equal amount every week. Each week the collected pool, minus our platform fee, is paid out to one member in rotation. You will only receive a payout for a week in which your own contributions are up to date. If you have a negative balance (you owe the pool), your payout is skipped until the amount is repaid. Payouts are credited to your LaaniPay wallet. Failure to pay when it is your turn to contribute may result in your removal from the cohort and forfeiture of the right to collect.',
  },
  {
    icon: Coins,
    title: '4. Referral Rewards',
    body: 'You may earn rewards when people you refer activate their account (registration rewards) and while they maintain an active monthly subscription (monthly subscription rewards). Rewards are paid from the activation and subscription fees themselves and can never exceed the fee that funds them. Rewards are not salaries, wages or guaranteed income from any effort other than successful introduction of new users.',
  },
  {
    icon: ShieldCheck,
    title: '5. Payments &amp; Security',
    body: 'Payments are processed by Paystack on behalf of LaaniPay (known as LaaniPay Global Services). Your card details are handled by Paystack and are never stored by us. Wallet balances are internal records — they are not bank deposits, are not insured by any deposit insurance scheme, and are not eligible for interest. You are responsible for keeping your login credentials safe.',
  },
  {
    icon: AlertTriangle,
    title: '6. Withdrawals &amp; Payouts',
    body: 'Weekly Ajo pool payouts and referral rewards are credited to your LaaniPay wallet as an internal balance. Wallet withdrawals are an admin-verified administrative settlement: you submit a request, funds are reserved (and therefore leave your available balance immediately), and a member of our operations team verifies the request before any money is released to you. Automatic or instant transfers to external bank accounts are not currently offered on this platform. A confirmed withdrawal request is not a guarantee of external payment, and we may decline or cancel a request where we suspect fraud, money laundering or breach of these terms, returning the reserved funds to your wallet. We reserve the right to freeze funds connected to verified abuse.',
  },
  {
    icon: ShieldCheck,
    title: '7. Eligibility',
    body: 'You must be at least 18 years old and a resident of Nigeria to use the service. You agree to provide accurate information and to update it when it changes. You may maintain only one account; duplicate accounts may be suspended.',
  },
  {
    icon: ShieldCheck,
    title: '8. Suspension &amp; Termination',
    body: 'We may suspend or close your account if you breach these terms, attempt to abuse the referral system, make fraudulent payments, or otherwise act against the interest of the community. Suspended accounts may forfeit uncollected benefits. You may stop using the service at any time, but outstanding contributions remain payable.',
  },
  {
    icon: ShieldCheck,
    title: '9. Changes to these Terms',
    body: 'We may update these terms from time to time. Significant changes will be communicated through the platform. Continued use of the service after changes take effect means you accept the updated terms.',
  },
];

export default function Terms() {
  return (
    <div className="container-lp pt-28 pb-16">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Legal</span>
        <h1 className="section-title text-slate-900">Terms &amp; Conditions</h1>
        <p className="max-w-2xl text-sm text-slate-500">
          Last updated: September 2026. Please read these terms carefully before using the
          LaaniPay platform.
        </p>
      </div>

      <div className="mt-6 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          LaaniPay is not a bank and provides no guaranteed returns. All benefits described on this
          platform are funded entirely from the fees members pay — there is no external investment
          engine. Only contribute money you can afford to spare within your savings plan.
        </p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {sections.map((s) => (
          <div key={s.title} className="card-light p-6">
            <div className="flex items-center gap-2">
              <s.icon className="h-5 w-5 text-primary" />
              <h3 className="text-base font-bold text-slate-900">{s.title}</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 flex flex-col items-start gap-4 rounded-2xl bg-ink p-6 text-white md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <FileText className="h-6 w-6 text-neon" />
          <p className="max-w-xl text-sm text-white/60">
            Questions about these terms? Contact{' '}
            <a href="mailto:support@laanipay.ng" className="font-semibold text-neon hover:underline">
              support@laanipay.ng
            </a>
          </p>
        </div>
        <Link to="/signup" className="btn-neon">
          Create an account
        </Link>
      </div>
    </div>
  );
}