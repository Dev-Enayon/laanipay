import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function FullScreenLoader() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

// Protected pages (/dashboard, /wallet, /mlm, /contribution):
// requires login AND activation. Admins are routed to their dashboard.
export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (!user.activationStatus) return <Navigate to="/activate" replace />;
  return children;
}

// /activate: requires login, but redirects once activated.
export function ActivateRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  if (user.activationStatus) return <Navigate to="/dashboard" replace />;
  return children;
}

// Guest-only pages (/login, /signup): redirect logged-in users away.
export function GuestRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : user.activationStatus ? '/dashboard' : '/activate'} replace />;
  return children;
}

// Admin pages: requires an authenticated administrator.
export function AdminRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin') return <Navigate to="/dashboard" replace />;
  return children;
}
