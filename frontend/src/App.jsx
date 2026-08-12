import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import {
  ProtectedRoute,
  GuestRoute,
  ActivateRoute,
  FullScreenLoader,
} from './components/ProtectedRoute.jsx';
import Landing from './pages/Landing.jsx';

const Signup = lazy(() => import('./pages/Signup.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail.jsx'));
const Activate = lazy(() => import('./pages/Activate.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Wallet = lazy(() => import('./pages/Wallet.jsx'));
const Mlm = lazy(() => import('./pages/Mlm.jsx'));
const Contribution = lazy(() => import('./pages/Contribution.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

export default function App() {
  return (
    <ErrorBoundary>
      <Layout>
        <Suspense fallback={<FullScreenLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route
              path="/signup"
              element={
                <GuestRoute>
                  <Signup />
                </GuestRoute>
              }
            />
            <Route
              path="/login"
              element={
                <GuestRoute>
                  <Login />
                </GuestRoute>
              }
            />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route
              path="/activate"
              element={
                <ActivateRoute>
                  <Activate />
                </ActivateRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/wallet"
              element={
                <ProtectedRoute>
                  <Wallet />
                </ProtectedRoute>
              }
            />
            <Route
              path="/mlm"
              element={
                <ProtectedRoute>
                  <Mlm />
                </ProtectedRoute>
              }
            />
            <Route
              path="/contribution"
              element={
                <ProtectedRoute>
                  <Contribution />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Layout>
    </ErrorBoundary>
  );
}
