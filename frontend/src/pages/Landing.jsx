import { Link } from 'react-router-dom';
import {
  Smartphone,
  Network,
  PiggyBank,
  UserPlus,
  ShieldCheck,
  Users,
  Rocket,
  ArrowRight,
  Target,
  Eye,
  Zap,
} from 'lucide-react';
import Particles from '../components/Particles.jsx';
import GlassCard from '../components/GlassCard.jsx';
import Reveal from '../components/Reveal.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const SERVICES = [
  {
    icon: Smartphone,
    title: 'Telecom Services',
    description:
      'Buy airtime, data bundles and pay bills at competitive rates — instantly, from one dashboard.',
  },
  {
    icon: Network,
    title: 'MLM Earning System',
    description:
      'Invite others, grow your team and earn referral bonuses across multiple levels with ranks from Marketer to Diamond Director.',
  },
  {
    icon: PiggyBank,
    title: 'Monthly Contributions',
    description:
      'Join disciplined community savings from ₦1,000/month and watch your contribution grow month after month.',
  },
];

const STEPS = [
  { icon: UserPlus, title: 'Create your account', text: 'Sign up in under a minute with your name, email and phone.' },
  { icon: ShieldCheck, title: 'Pay the activation fee', text: 'A one-time ₦1,500 activation secured by Paystack.' },
  { icon: Users, title: 'Invite and earn', text: 'Share your referral link and earn bonuses as your team grows.' },
  { icon: Rocket, title: 'Save and grow', text: 'Contribute monthly and build long-term financial empowerment.' },
];

export default function Landing() {
  const { user } = useAuth();
  const ctaTo = user ? (user.activationStatus ? '/dashboard' : '/activate') : '/signup';

  return (
    <div>
      <section className="section-dark relative overflow-hidden">
        <div className="hero-gradient absolute inset-0 opacity-30" />
        <Particles className="absolute inset-0 h-full w-full" />
        <div className="container-lp relative z-10 flex flex-col items-center py-28 text-center md:py-40">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-neon/40 bg-neon/10 px-4 py-1.5 text-xs font-semibold tracking-wide text-neon">
              <Zap className="h-3.5 w-3.5" />
              Earn · Save · Grow
            </span>
          </Reveal>
          <Reveal delay={100}>
            <h1 className="mt-6 max-w-3xl text-4xl font-extrabold leading-tight md:text-6xl">
              The <span className="text-gradient">LaaniPay Ecosystem</span>
              <br />
              for your money.
            </h1>
          </Reveal>
          <Reveal delay={200}>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 md:text-lg">
              Telecom services, a powerful referral earning system and monthly contribution
              savings — all in one premium, trustworthy fintech platform built for Nigeria.
            </p>
          </Reveal>
          <Reveal delay={300}>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <Link to={ctaTo} className="btn-neon animate-pulse-glow">
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#about" className="btn-ghost">
                Learn More
              </a>
            </div>
          </Reveal>
          <Reveal delay={400}>
            <div className="mt-16 grid w-full max-w-3xl grid-cols-3 gap-4">
              {[
                { value: '₦1,500', label: 'One-time activation' },
                { value: '3', label: 'Earning levels' },
                { value: '5', label: 'Member ranks' },
              ].map((stat) => (
                <div key={stat.label} className="glass px-4 py-5">
                  <p className="text-2xl font-extrabold text-neon">{stat.value}</p>
                  <p className="mt-1 text-xs text-white/60">{stat.label}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-ink to-transparent" />
      </section>

      <section id="about" className="container-lp py-24">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">About</span>
            <h2 className="section-title mt-3">
              A complete financial ecosystem in <span className="text-gradient">one platform</span>
            </h2>
            <p className="mt-5 text-slate-600">
              LaaniPay brings together everyday telecom services with a community-driven earning
              model. Activate once, then earn through referrals and build a savings culture with
              monthly contributions — all tracked live on your dashboard.
            </p>
          </div>
        </Reveal>
      </section>

      <section className="section-dark py-24">
        <div className="container-lp">
          <Reveal>
            <div className="mx-auto max-w-3xl text-center">
              <span className="text-xs font-bold uppercase tracking-widest text-neon">Services</span>
              <h2 className="section-title mt-3 text-white">What you can do</h2>
            </div>
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {SERVICES.map((service, index) => (
              <Reveal key={service.title} delay={index * 120}>
                <GlassCard glow={index === 2 ? 'neon' : 'blue'}>
                  <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-neon">
                    <service.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="text-lg font-bold text-white">{service.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/60">{service.description}</p>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="container-lp py-24">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">How it works</span>
            <h2 className="section-title mt-3">Four steps to financial empowerment</h2>
          </div>
        </Reveal>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 120}>
              <div className="card-light relative h-full p-6 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-glow">
                <span className="absolute right-5 top-4 text-5xl font-extrabold text-slate-100">
                  {index + 1}
                </span>
                <div className="relative mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <step.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="relative text-base font-bold text-slate-900">{step.title}</h3>
                <p className="relative mt-2 text-sm text-slate-600">{step.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section-dark py-24">
        <div className="container-lp grid gap-6 md:grid-cols-2">
          <Reveal>
            <GlassCard>
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
                <Target className="h-6 w-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold text-white">Our Mission</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                To empower every Nigerian with a simple, transparent platform to earn from telecom
                services and build wealth through community-driven savings and referrals.
              </p>
            </GlassCard>
          </Reveal>
          <Reveal delay={120}>
            <GlassCard glow="neon">
              <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-neon/20">
                <Eye className="h-6 w-6 text-neon" />
              </div>
              <h3 className="text-xl font-bold text-white">Our Vision</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">
                A financially empowered generation where everyday telecom spending becomes a
                stepping stone to savings and sustained earning — a LaaniPay ecosystem for all.
              </p>
            </GlassCard>
          </Reveal>
        </div>
      </section>

      <section className="container-lp py-24 text-center">
        <Reveal>
          <h2 className="section-title">Ready to start your journey?</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-600">
            Create your free account today and take the first step into the LaaniPay Ecosystem.
          </p>
          <Link to={ctaTo} className="btn-primary mt-8">
            Open your account <ArrowRight className="h-4 w-4" />
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
