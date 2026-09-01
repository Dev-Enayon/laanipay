import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, ScrollText, ShieldCheck, Bell } from 'lucide-react';

const tabs = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/notifications', label: 'Notifications', icon: Bell },
  { to: '/admin/audit', label: 'Audit Logs', icon: ScrollText },
];

export default function AdminLayout() {
  return (
    <div className="container-lp pt-24 pb-16">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-dark via-primary to-neon px-6 py-8 md:px-10">
        <div className="hero-gradient absolute inset-0 opacity-20" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-widest text-white backdrop-blur">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-white md:text-4xl">
              Management dashboard
            </h1>
            <p className="mt-2 text-sm font-medium text-white/80">
              Oversee members, wallets, contributions and platform activity.
            </p>
          </div>
        </div>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition-all duration-300 ${
                isActive
                  ? 'bg-primary text-white shadow-glow'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-primary/40 hover:text-primary'
              }`
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-8">
        <Outlet />
      </div>
    </div>
  );
}
