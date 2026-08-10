# LaaniPay Ecosystem — Senior Developer Build Brief

## 📌 Project Overview

Build **LaaniPay Ecosystem**, a Nigerian fintech web platform combining:

- Telecom services (airtime, data, bill payments)
- MLM earning system
- Monthly contribution / community savings platform
- Financial empowerment tools

Target feel: premium, trustworthy, modern fintech product — comparable to Paystack, Flutterwave, or a modern mobile banking app. Production-ready, not a prototype.

---

## 🔒 Non-Negotiable Technical Decisions

These two constraints override anything else in this brief or in any earlier draft:

1. **Payment Gateway: Paystack ONLY.**
   No Flutterwave, no Stripe, no other processor, and no "payment provider abstraction layer" — build directly against the Paystack API (Inline JS on the frontend + REST verification on the backend). Do not add multi-gateway support now or leave placeholder hooks for it.

2. **Database: Neon (serverless Postgres) ONLY.**
   All persistent data — users, wallets, transactions, MLM tree/referrals, contribution plans, contribution payments, audit logs — lives in a Neon Postgres instance. No SQLite, no MongoDB, no local Postgres for prod parity. Use Neon's connection pooling (pooled connection string) for serverless-friendly access.

---

## ⚙️ Tech Stack

| Layer | Choice |
|---|---|
| Frontend | React (Vite) — not vanilla HTML/JS, since the app needs auth state, protected routes, and live dashboard data |
| Backend | Node.js + Express |
| ORM | Prisma (Neon has first-class Prisma support via `@prisma/adapter-neon` or standard pooled connection string) |
| Database | **Neon Postgres** (serverless, branchable) |
| Auth | JWT (access + refresh tokens), bcrypt for password hashing |
| Payments | **Paystack** (Inline JS for checkout, REST API for server-side verification) |
| Styling | Tailwind CSS (swap for Bootstrap 5 only if you strongly prefer — Tailwind gives more control over the glassmorphism/neon aesthetic described below) |
| Fonts | Poppins (Google Fonts) |
| Deployment | Frontend → Vercel; Backend → Render (matches existing GOTM/LaaniPay deployment pattern); DB → Neon (already serverless, no separate hosting needed) |

> If Node/Express isn't the preferred backend, Django REST Framework + Neon (via `DATABASE_URL`) is a drop-in substitute — Neon is framework-agnostic Postgres, so this brief's data model and API contract stay valid either way.

---

## 🗄️ Data Model (Neon Postgres via Prisma)

Minimum required tables:

- `users` — id, full_name, email (unique), phone, password_hash, activation_status (bool), created_at
- `wallets` — id, user_id (FK), balance, updated_at
- `activation_payments` — id, user_id (FK), paystack_reference (unique), amount, status, verified_at
- `mlm_referrals` — id, user_id (FK), referrer_id (FK, nullable), level, bonus_earned
- `mlm_ranks` — id, user_id (FK), rank (marketer/manager/director/ruby_director/diamond_director), achieved_at
- `contribution_plans` — id, name, monthly_amount (₦1,000 / ₦2,000 / ₦5,000 tiers)
- `contribution_subscriptions` — id, user_id (FK), plan_id (FK), status, next_payment_date
- `contribution_payments` — id, subscription_id (FK), paystack_reference (unique), amount, status, paid_at
- `audit_logs` — id, user_id (FK), action, metadata (jsonb), created_at

All monetary fields stored in **kobo** (integer) to avoid float rounding issues, displayed in naira on the frontend.

---

## 💳 Paystack Integration Flow (Activation Fee — ₦1,500)

1. **Frontend:** User completes signup form → redirected to activation payment screen.
2. **Frontend:** Trigger Paystack Inline JS with `email`, `amount: 150000` (kobo), and the Paystack **public key** (env var, never hardcoded).
3. **Backend:** On Paystack callback, frontend sends the `reference` to `POST /api/payments/verify`.
4. **Backend:** Server calls Paystack's `GET /transaction/verify/:reference` using the **secret key** (server-side only, never exposed to frontend).
5. **Backend:** On `status: success` — mark `activation_payments` row verified, flip `users.activation_status = true`, log to `audit_logs`, return JWT session.
6. **Frontend:** Redirect to `/dashboard` only after backend confirms verification — **never** trust the client-side Paystack callback alone as proof of payment.

Apply the same verify-on-server pattern to monthly contribution payments (`contribution_payments`).

---

## 🎨 Design System

**Palette**
| Name | Hex |
|---|---|
| Primary Blue | `#0050ff` |
| Dark Blue | `#002b73` |
| Neon Green | `#00ff88` |
| Black Background | `#050505` |
| Light Background | `#f8f9fa` |
| White | `#ffffff` |

**Typography:** Poppins, clean/spacious/modern fintech style.

**Visual language:** glassmorphism cards, neon glow hover states, animated gradient hero background, floating particles, scroll-reveal animations, smooth transitions — mobile-first throughout.

---

## 🖥️ Pages / Routes

| Route | Purpose |
|---|---|
| `/` | Landing page — hero, about, services (Telecom / MLM / Contributions), how-it-works (4 steps), mission & vision |
| `/signup` | Registration form + Terms & Conditions checkbox (submit disabled until checked) |
| `/login` | Email + password, forgot-password link |
| `/activate` | Paystack ₦1,500 activation payment (replaces static `payment.html`) |
| `/dashboard` | Protected route — welcome card, two entry cards: MLM Platform / Contribution Platform |
| `/mlm` | Protected — compensation plans (Basic, Pro with ranks Marketer→Diamond Director), Monthly Verification Plan |
| `/contribution` | Protected — plan tiers (₦1,000 / ₦2,000 / ₦5,000), next payment date, history, progress tracker |

**Access control:**
- Logged out → navbar shows Home / About / Login / Sign Up
- Logged in but not activated → forced to `/activate`, dashboard/MLM/contribution routes blocked
- Logged in + activated → navbar shows Dashboard / MLM / Contribution / Logout

---

## 🔐 Security Requirements

- Paystack **secret key** lives only in backend env vars (Render), never shipped to frontend.
- Paystack **public key** is the only Paystack credential in frontend env vars.
- All payment status changes happen server-side after Paystack verification — client never writes `activation_status` or payment records directly.
- Passwords hashed with bcrypt (min 10 rounds).
- JWT access token short-lived (~15 min) + refresh token flow.
- Rate-limit `/api/auth/login` and `/api/payments/verify` endpoints.
- Neon connection string (pooled) stored as `DATABASE_URL` env var, never committed.

---

## 📦 Deliverables Expected From the Dev

1. Neon Postgres schema + Prisma migrations
2. Express API (auth, payments, MLM, contributions, wallet)
3. React frontend (all routes above) wired to the API
4. Paystack integration (frontend inline checkout + backend verification) — **Paystack only, no other gateway code paths**
5. Deployment: backend on Render, frontend on Vercel, env vars documented in a `.env.example` for both
6. Basic seed script (Prisma seed) for contribution plan tiers and an admin/head account

---

## 🚫 Explicitly Out of Scope (unless later requested)

- Any payment gateway other than Paystack
- Any database other than Neon Postgres
- Native mobile app
- Admin analytics dashboard beyond basic audit log viewing
