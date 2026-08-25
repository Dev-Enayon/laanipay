import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, CreditCard, CheckCircle2, Loader2, MailCheck, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import { naira } from '../lib/format.js';
import { payWithPaystack } from '../lib/paystack.js';
import { useAuth } from '../context/AuthContext.jsx';

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

export default function Activate() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const emailWarning = location.state?.emailWarning ?? null;

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState('');

  // Pick up an email verification done in another tab.
  useEffect(() => {
    if (!user?.emailVerified) refreshUser().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResend = async () => {
    setResending(true);
    setResendMsg('');
    try {
      const data = await api('/auth/resend-verification', {
        method: 'POST',
        body: { email: user.email },
      });
      setResendMsg(data?.emailWarning ?? data?.message ?? 'Verification email sent');
      refreshUser().catch(() => {});
    } catch (err) {
      setResendMsg(err.message ?? 'Could not resend verification email');
    } finally {
      setResending(false);
    }
  };

  const handlePay = async () => {
    setError('');
    setInfo('');
    setBusy(true);

    try {
      if (!PAYSTACK_PUBLIC_KEY) {
        throw new Error('Paystack public key is not configured');
      }

      const init = await api('/payments/initialize', { method: 'POST' });

      await payWithPaystack({
        key: PAYSTACK_PUBLIC_KEY,
        email: init.email,
        amountKobo: init.amount,
        reference: init.reference,
        metadata: { custom_fields: [{ display_name: 'LaaniPay Activation', variable_name: 'purpose', value: 'Account activation' }] },
        onSuccess: async (reference) => {
          try {
            setInfo('Payment received. Verifying with Paystack...');
            const result = await api('/payments/verify', { method: 'POST', body: { reference } });

            if (result.verified) {
              setVerified(true);
              await refreshUser();
              setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ink via-primary-dark to-ink px-6 pt-24 pb-16">
      <div className="w-full max-w-md">
        <div className="glass p-8 text-white">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-neon">
              <CreditCard className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold">Activate your account</h1>
            <p className="mt-2 text-sm text-white/60">
              A one-time activation fee unlocks the full LaaniPay Ecosystem.
            </p>
          </div>

          <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/60">Activation fee</span>
              <span className="text-2xl font-extrabold text-neon">{naira(150000)}</span>
            </div>
            <p className="mt-2 text-xs text-white/40">One-time payment · Paystack secured</p>
          </div>

          {emailWarning && (
            <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                {emailWarning}
              </div>
            </div>
          )}

          {!user?.emailVerified && (
            <div className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 p-5 text-sm text-amber-200">
              <div className="flex items-center gap-2 font-medium">
                <MailCheck className="h-4 w-4" />
                Verify your email to activate your account
              </div>
              <p className="mt-1 text-xs text-amber-200/70">
                We sent a verification link to <span className="font-semibold text-amber-100">{user?.email}</span>.
              </p>
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="mt-3 w-full rounded-lg border border-amber-400/40 bg-amber-400/10 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/20 disabled:opacity-50"
              >
                {resending ? 'Sending...' : 'Resend verification email'}
              </button>
              {resendMsg && (
                <p className="mt-2 text-xs text-amber-200/80">{resendMsg}</p>
              )}
            </div>
          )}

          {verified && (
            <div className="mt-5 flex items-center gap-2 rounded-xl bg-neon/10 px-4 py-3 text-sm font-medium text-neon">
              <CheckCircle2 className="h-5 w-5" />
              Account activated! Taking you to your dashboard...
            </div>
          )}

          {info && (
            <div className="mt-5 flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-3 text-sm text-white/80">
              <Loader2 className="h-4 w-4 animate-spin" />
              {info}
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-xl bg-red-500/10 px-4 py-3 text-sm font-medium text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={handlePay}
            disabled={busy || verified || !user?.emailVerified}
            className="btn-neon mt-8 w-full"
          >
            {busy
              ? 'Opening secure checkout...'
              : user?.emailVerified
                ? 'Pay activation fee'
                : 'Verify your email to continue'}
          </button>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-white/40">
            <ShieldCheck className="h-3.5 w-3.5" />
            You will be redirected to Paystack to complete payment securely.
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-white/40">
          Logged in as <span className="text-white/70">{user?.email}</span>
        </p>
      </div>
    </div>
  );
}
