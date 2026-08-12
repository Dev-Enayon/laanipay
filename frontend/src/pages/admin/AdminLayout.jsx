import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Users, ScrollText } from 'lucide-react';

const tabs = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/audit', label: 'Audit Logs', icon: ScrollText },
];

export default function AdminLayout() {
  return (
    <div className="container-lp pt-28 pb-16">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-bold uppercase tracking-widest text-primary">Admin</span>
        <h1 className="section-title text-slate-900">Management dashboard</h1>
      </div>

      <nav className="mt-6 flex flex-wrap gap-2 border-b border-slate-100">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              `inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-slate-500 hover:text-primary'
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
