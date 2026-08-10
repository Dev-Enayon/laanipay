import { Link } from 'react-router-dom';
import { Mail, Phone } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="section-dark mt-24">
      <div className="container-lp grid gap-10 py-14 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-neon text-lg font-extrabold text-ink">
              L
            </span>
            <span className="text-lg font-bold text-white">LaaniPay</span>
          </div>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">
            The LaaniPay Ecosystem combines telecom services, a referral earning system and
            monthly contribution savings — built for a financially empowered Nigeria.
          </p>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">Platform</h4>
          <ul className="space-y-2 text-sm text-white/60">
            <li>
              <Link to="/signup" className="transition-colors hover:text-neon">Open an account</Link>
            </li>
            <li>
              <Link to="/login" className="transition-colors hover:text-neon">Login</Link>
            </li>
            <li>
              <Link to="/contribution" className="transition-colors hover:text-neon">Contributions</Link>
            </li>
            <li>
              <Link to="/mlm" className="transition-colors hover:text-neon">MLM Platform</Link>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-white">Contact</h4>
          <ul className="space-y-3 text-sm text-white/60">
            <li className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-neon" />
              <a href="mailto:support@laanipay.ng" className="transition-colors hover:text-neon">
                support@laanipay.ng
              </a>
            </li>
            <li className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-neon" />
              <span>+234 800 000 0000</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="container-lp flex flex-col items-center justify-between gap-2 py-5 text-xs text-white/40 sm:flex-row">
          <p>© {new Date().getFullYear()} LaaniPay Ecosystem. All rights reserved.</p>
          <p>Payments securely processed by Paystack.</p>
        </div>
      </div>
    </footer>
  );
}
