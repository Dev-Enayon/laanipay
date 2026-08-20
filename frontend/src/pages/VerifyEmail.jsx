import { useEffect, useState } from 'react';
import { Link, useSearchParams, Navigate } from 'react-router-dom';
import { MailCheck, MailX, Loader2, ArrowRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const { user, refreshUser } = useAuth();

  const [state, setState] = useState('loading'); // loading | success | error | invalid
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    if (!token) {
      if (active) setState('invalid');
      return;
    }
    api('/auth/verify-email', { method: 'POST', body: { token } })
      .then(async (data) => {
        if (!active) return;
        setMessage(data?.message ?? 'Email verified successfully');
        setState('success');
        try { await refreshUser(); } catch { /* ok */ }
      })
      .catch((err) => {
        if (!active) return;
        setMessage(err.message ?? 'Verification failed');
        setState('error');
      });
    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-light via-white to-primary/5 px-6 pt-24 pb-16">
      <div className="w-full max-w-md">
        <div className="card-light p-8 text-center">
          {state === 'loading' && (
            <>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Verifying your email</h1>
              <p className="mt-2 text-sm text-slate-500">Please wait a moment...</p>
            </>
          )}

          {state === 'success' && (
            <>
              {user && <Navigate to={user.activationStatus ? '/dashboard' : '/activate'} replace />}
              {!user && (
                <>
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-neon/10">
                    <MailCheck className="h-8 w-8 text-emerald-600" />
                  </div>
                  <h1 className="text-2xl font-bold text-slate-900">Email verified!</h1>
                  <p className="mt-2 text-sm text-slate-500">{message}</p>
                  <Link to="/login" className="btn-primary mt-8 inline-flex w-full items-center justify-center gap-2">
                    Continue to login <ArrowRight className="h-4 w-4" />
                  </Link>
                </>
              )}
            </>
          )}

          {(state === 'error' || state === 'invalid') && (
            <>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50">
                <MailX className="h-8 w-8 text-red-500" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900">Could not verify email</h1>
              <p className="mt-2 text-sm text-slate-500">{message || 'This link is invalid or has expired.'}</p>
              <p className="mt-4 text-xs text-slate-400">
                Request a new verification link from your account page, or
                <Link to="/login" className="font-semibold text-primary hover:underline"> login </Link>
                to resend it.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
