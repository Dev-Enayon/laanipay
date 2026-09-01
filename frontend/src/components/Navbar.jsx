import { useState, useEffect } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, LayoutDashboard, Wallet, Network, PiggyBank, LogOut, Sparkles, ShieldCheck, Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../lib/api.js';

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
          {user && (
            <Link
              to="/notifications"
              className={`relative ml-1 inline-flex items-center px-2 py-2 transition-colors ${onDark ? 'text-white/80 hover:text-neon' : 'text-slate-600 hover:text-primary'}`}
              title="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && (
                <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
          )}
          {user && (
            <button
              onClick={handleLogout}
              className="ml-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-red-300 hover:text-red-500"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          )}
        </div>

        <button
          className={`md:hidden ${onDark ? 'text-white' : 'text-slate-900'}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-slate-200 bg-white px-6 py-4 shadow-xl md:hidden">
          <div className="flex flex-col gap-2">
            {!user && (
              <Link to="/" onClick={() => setOpen(false)} className="py-2 text-sm font-medium text-slate-700">
                Home
              </Link>
            )}
            <a href="/#about" onClick={() => setOpen(false)} className="py-2 text-sm font-medium text-slate-700">
              About
            </a>
            {user?.role === 'admin' ? (
              <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700">
                <ShieldCheck className="h-4 w-4" /> Admin Dashboard
              </Link>
            ) : (
              user?.activationStatus && (
                <>
                  <Link to="/dashboard" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700">
                    <LayoutDashboard className="h-4 w-4" /> Dashboard
                  </Link>
                  <Link to="/wallet" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700">
                    <Wallet className="h-4 w-4" /> Wallet
                  </Link>
                  <Link to="/mlm" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700">
                    <Network className="h-4 w-4" /> MLM Platform
                  </Link>
                  <Link to="/contribution" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700">
                    <PiggyBank className="h-4 w-4" /> Contribution
                  </Link>
                </>
              )
            )}
            {user && user.activationStatus && (
              <Link to="/notifications" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700">
                <Bell className="h-4 w-4" /> Notifications
                {unread > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
              </Link>
            )}
            {user && !user.activationStatus && (
              <Link to="/activate" onClick={() => setOpen(false)} className="flex items-center gap-2 py-2 text-sm font-medium text-slate-700">
                <Sparkles className="h-4 w-4" /> Activate Account
              </Link>
            )}
            {!user && (
              <Link to="/login" onClick={() => setOpen(false)} className="py-2 text-sm font-medium text-slate-700">
                Login
              </Link>
            )}
            {!user && (
              <Link
                to="/signup"
                onClick={() => setOpen(false)}
                className="mt-2 inline-flex items-center justify-center rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white"
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
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-600"
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
