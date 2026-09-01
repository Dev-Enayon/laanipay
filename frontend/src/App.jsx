import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import {
  ProtectedRoute,
  GuestRoute,
  ActivateRoute,
  AdminRoute,
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
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout.jsx'));
const AdminOverview = lazy(() => import('./pages/admin/AdminOverview.jsx'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers.jsx'));
const AdminUserDetail = lazy(() => import('./pages/admin/AdminUserDetail.jsx'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit.jsx'));
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications.jsx'));

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
            <Route
              path="/notifications"
              element={
                <ProtectedRoute>
                  <Notifications />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <AdminRoute>
                  <AdminLayout />
                </AdminRoute>
              }
            >
              <Route index element={<AdminOverview />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="users/:id" element={<AdminUserDetail />} />
              <Route path="audit" element={<AdminAudit />} />
              <Route path="notifications" element={<AdminNotifications />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Layout>
    </ErrorBoundary>
  );
}
