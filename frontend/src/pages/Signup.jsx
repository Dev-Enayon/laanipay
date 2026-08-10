import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Gift, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    referralCode: searchParams.get('ref') ?? '',
  });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!agreed) {
      setError('You must accept the Terms & Conditions');
      return;
    }

    setSubmitting(true);
    try {
      const { fullName, email, phone, password, referralCode } = form;
      await signup({ fullName, email, phone, password, referralCode });
      navigate('/activate', { replace: true });
    } catch (err) {
      setError(err.message ?? 'Signup failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-light via-white to-primary/5 px-6 pt-24 pb-16">
      <div className="w-full max-w-md">
        <div className="card-light p-8">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
            <p className="mt-2 text-sm text-slate-500">
              Join the LaaniPay Ecosystem — free to sign up.
            </p>
          </div>

          {form.referralCode && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-neon/40 bg-neon/10 px-4 py-3 text-sm font-medium text-emerald-700">
              <Gift className="h-4 w-4" />
              Referral code applied
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="fullName">Full name</label>
              <input
                id="fullName"
                className="input"
                placeholder="e.g. Ada Obi"
                value={form.fullName}
                onChange={update('fullName')}
                autoComplete="name"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="email">Email address</label>
              <input
                id="email"
                type="email"
                className="input"
                placeholder="you@example.com"
                value={form.email}
                onChange={update('email')}
                autoComplete="email"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="phone">Phone number</label>
              <input
                id="phone"
                type="tel"
                className="input"
                placeholder="+234 800 000 0000"
                value={form.phone}
                onChange={update('phone')}
                autoComplete="tel"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={update('password')}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="confirmPassword">Confirm password</label>
              <input
                id="confirmPassword"
                type="password"
                className="input"
                placeholder="Repeat your password"
                value={form.confirmPassword}
                onChange={update('confirmPassword')}
                autoComplete="new-password"
                required
              />
            </div>

            <div>
              <label className="label" htmlFor="referralCode">
                Referral code <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="referralCode"
                className="input"
                placeholder="Paste a friend's referral code"
                value={form.referralCode}
                onChange={update('referralCode')}
              />
            </div>

            <label className="flex cursor-pointer items-start gap-3 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
              />
              <span>
                I have read and agree to the{' '}
                <span className="font-semibold text-primary">Terms &amp; Conditions</span> and{' '}
                <span className="font-semibold text-primary">Privacy Policy</span>.
              </span>
            </label>

            {error && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600">{error}</p>
            )}

            <button type="submit" disabled={submitting || !agreed} className="btn-primary w-full">
              {submitting ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-sm text-slate-500">
            Already have an account?
            <Link to="/login" className="font-semibold text-primary hover:underline">
              Login
            </Link>
          </p>

          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            Secured by Paystack
          </p>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1 text-center text-xs text-slate-400">
          One-time activation fee of ₦1,500 applies after signup <ArrowRight className="h-3 w-3" />
        </p>
      </div>
    </div>
  );
}
