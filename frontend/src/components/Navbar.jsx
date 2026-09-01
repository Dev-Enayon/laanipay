import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LayoutDashboard, Wallet, Network, PiggyBank, LogOut, Sparkles, ShieldCheck, Bell, ChevronDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';
import { initials } from '../lib/format.js';

const linkClass = ({ isActive }) =>
  `px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'text-primary' : 'text-slate-600 hover:text-primary'
  }`;

const darkLinkClass = ({ isActive }) =>
  `px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'text-neon' : 'text-white/80 hover:text-neon'
  }`;

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [unread, setUnread] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  useEffect(() => {
    const onClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    setOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    let active = true;
    const fetchUnread = () =>
      api('/notifications/unread-count')
        .then((d) => active && setUnread(d.count ?? 0))
        .catch(() => {});
    fetchUnread();
    const onUpdated = () => fetchUnread();
    window.addEventListener('laani:notifications-updated', onUpdated);
    return () => {
      active = false;
      window.removeEventListener('laani:notifications-updated', onUpdated);
    };
  }, [user]);

  const isLanding = location.pathname === '/';
  const onDark = isLanding && !scrolled;

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  const navClass = onDark ? darkLinkClass : linkClass;

  const guestLinks = (
    <>
      <a href="/#about" className={navClass}>
        About
      </a>
      <Link to="/login" className={navClass}>
        Login
      </Link>
      <Link
        to="/signup"
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary-dark hover:shadow-glow"
      >
        Sign Up
      </Link>
    </>
  );

  const inactiveLinks = (
    <>
      <a href="/#about" className={navClass}>
        About
      </a>
      <Link
        to="/activate"
        className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-primary-dark hover:shadow-glow"
      >
        Activate Account
      </Link>
    </>
  );

  const activeLinks = user?.role === 'admin' ? (
    <NavLink to="/admin" className={navClass}>
      Admin Dashboard
    </NavLink>
  ) : (
    <>
      <NavLink to="/dashboard" className={navClass}>
        Dashboard
      </NavLink>
      <NavLink to="/wallet" className={navClass}>
        Wallet
      </NavLink>
      <NavLink to="/mlm" className={navClass}>
        MLM
      </NavLink>
      <NavLink to="/contribution" className={navClass}>
        Contribution
      </NavLink>
    </>
  );

  const links = !user
    ? guestLinks
    : user.activationStatus
      ? activeLinks
      : inactiveLinks;

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        onDark ? 'bg-transparent' : 'border-b border-slate-200/80 bg-white/80 backdrop-blur-xl'
      }`}
    >
      <nav className="container-lp flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl">
            <img src="/logo.jpeg" alt="LaaniPay" className="h-full w-full object-cover" />
          </span>
          <span className={`text-lg font-bold ${onDark ? 'text-white' : 'text-slate-900'}`}>
            LaaniPay
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {!user && (
            <NavLink to="/" end className={navClass}>
              Home
            </NavLink>
          )}
          {links}
        </div>

        <div className="flex items-center gap-1.5 md:hidden">
          {user && (
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className={`relative inline-flex items-center rounded-xl p-2 transition-colors ${onDark ? 'text-white/80 hover:text-neon' : 'text-slate-600 hover:text-primary'}`}
              title="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          )}
          <button
            className={`rounded-xl p-2 transition-colors ${onDark ? 'text-white' : 'text-slate-900'}`}
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>

        {user && (
          <div className="hidden items-center gap-2 md:flex">
            <Link
              to="/notifications"
              className={`relative inline-flex items-center rounded-xl p-2 transition-colors ${onDark ? 'text-white/80 hover:text-neon' : 'text-slate-600 hover:text-primary'}`}
              title="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            <span className={`h-6 w-px ${onDark ? 'bg-white/15' : 'bg-slate-200'}`} />

            <div ref={profileRef} className="relative">
              <button
                onClick={() => setProfileOpen((v) => !v)}
                className={`flex items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-2 transition-colors ${
                  profileOpen ? 'bg-slate-100' : onDark ? 'hover:bg-white/10' : 'hover:bg-slate-100'
                }`}
                aria-haspopup="menu"
                aria-expanded={profileOpen}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-neon text-xs font-extrabold uppercase text-white">
                  {initials(user.fullName)}
                </span>
                <span className={`text-left leading-tight ${onDark ? 'text-white' : ''}`}>
                  <span className={`block text-[11px] font-medium ${onDark ? 'text-white/50' : 'text-slate-400'}`}>
                    {greeting}
                  </span>
                  <span className={`block max-w-[120px] truncate text-sm font-semibold ${onDark ? 'text-white' : 'text-slate-900'}`}>
                    {firstName || user.email}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${onDark ? 'text-white/50' : 'text-slate-400'} ${
                    profileOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {profileOpen && (
                <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-64 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-card">
                  <div className="bg-gradient-to-br from-primary/5 to-neon/5 px-4 py-3">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      {user.role === 'admin' ? 'Administrator' : 'Member'}
                    </p>
                    <p className="mt-1 truncate text-sm font-bold text-slate-900">{user.fullName}</p>
                    <p className="truncate text-xs text-slate-500">{user.email}</p>
                  </div>

                  {user.activationStatus && (
                    <div className="border-b border-slate-100 px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-400">
                        {greeting}, {firstName}
                      </p>
                    </div>
                  )}

                  <div className="flex flex-col p-2">
                    <Link
                      to={user.role === 'admin' ? '/admin' : '/dashboard'}
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      {user.role === 'admin' ? <ShieldCheck className="h-4 w-4 text-primary" /> : <LayoutDashboard className="h-4 w-4 text-primary" />}
                      {user.role === 'admin' ? 'Admin Dashboard' : 'My Dashboard'}
                    </Link>
                    <Link
                      to="/notifications"
                      onClick={() => setProfileOpen(false)}
                      className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-2.5">
                        <Bell className="h-4 w-4 text-slate-400" /> Notifications
                      </span>
                      {unread > 0 && (
                        <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{unread}</span>
                      )}
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-red-50 hover:text-red-500"
                    >
                      <LogOut className="h-4 w-4" /> Logout
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>

      {open && (
        <div className="border-t border-slate-200 bg-white shadow-xl md:hidden">
          <div className="max-h-[calc(100dvh-4rem)] flex flex-col gap-1 overflow-y-auto px-5 py-4">
            {user && (
              <div className="mb-2 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-3 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-neon text-sm font-extrabold uppercase text-white">
                  {initials(user.fullName)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-400">
                    {greeting}, {firstName}
                  </p>
                  <p className="truncate text-sm font-bold text-slate-900">{user.fullName}</p>
                  <p className="truncate text-xs text-slate-500">{user.email}</p>
                </div>
              </div>
            )}
            {!user && (
              <Link to="/" onClick={() => setOpen(false)} className="rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Home
              </Link>
            )}
            <a href="/#about" onClick={() => setOpen(false)} className="rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
              About
            </a>
            {user?.role === 'admin' ? (
              <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <ShieldCheck className="h-4 w-4" /> Admin Dashboard
              </Link>
            ) : (
              user?.activationStatus && (
                <>
                  <Link to="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                    <LayoutDashboard className="h-4 w-4" /> Dashboard
                  </Link>
                  <Link to="/wallet" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                    <Wallet className="h-4 w-4" /> Wallet
                  </Link>
                  <Link to="/mlm" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                    <Network className="h-4 w-4" /> MLM Platform
                  </Link>
                  <Link to="/contribution" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                    <PiggyBank className="h-4 w-4" /> Contribution
                  </Link>
                </>
              )
            )}
            {user && user.activationStatus && (
              <Link to="/notifications" onClick={() => setOpen(false)} className="flex items-center justify-between rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <span className="flex items-center gap-3">
                  <Bell className="h-4 w-4" /> Notifications
                </span>
                {unread > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-bold text-white">{unread}</span>}
              </Link>
            )}
            {user && !user.activationStatus && (
              <Link to="/activate" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                <Sparkles className="h-4 w-4" /> Activate Account
              </Link>
            )}
            {!user && (
              <Link to="/login" onClick={() => setOpen(false)} className="rounded-xl py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
                Login
              </Link>
            )}
            {!user && (
              <Link
                to="/signup"
                onClick={() => setOpen(false)}
                className="mt-1 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark"
              >
                Sign Up
              </Link>
            )}
            {user && (
              <button
                onClick={() => {
                  setOpen(false);
                  handleLogout();
                }}
                className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-600 transition hover:border-red-300 hover:text-red-500"
              >
                <LogOut className="h-4 w-4" /> Logout
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
