import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, CreditCard, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { naira } from '../lib/format.js';
import { payWithPaystack } from '../lib/paystack.js';
import { useAuth } from '../context/AuthContext.jsx';

const PAYSTACK_PUBLIC_KEY = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;

export default function Activate() {
  const { user, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);

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
          setInfo('Payment received. Verifying with Paystack...');
          const result = await api('/payments/verify', { method: 'POST', body: { reference } });

          if (result.verified) {
            setVerified(true);
            await refreshUser();
            setTimeout(() => navigate('/dashboard', { replace: true }), 1200);
          } else {
            setError('We could not confirm your payment. Please try again.');
          }
        },
        onCancel: () => {
          setInfo('');
        },
      });
    } catch (err) {
      setError(err.message ?? 'Could not start payment. Please try again.');
    } finally {
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

          <button onClick={handlePay} disabled={busy || verified} className="btn-neon mt-8 w-full">
            {busy ? 'Opening secure checkout...' : 'Pay activation fee'}
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
