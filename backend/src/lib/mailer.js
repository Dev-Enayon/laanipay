import { env } from '../config/env.js';

// Minimal email layer on top of the Resend API (https://resend.com).
// Every helper is fire-and-forget safe: it never throws, so a mail outage
// can never break a payment, signup, or any other request flow.

const RESEND_URL = 'https://api.resend.com/emails';

export function formatNaira(kobo) {
  return `₦${Number((kobo ?? 0) / 100).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
}

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Segoe UI,Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8eaf0;">
            <tr>
              <td style="background:linear-gradient(135deg,#0ea5e9,#10b981);padding:28px 32px;">
                <div style="color:#ffffff;font-size:22px;font-weight:800;letter-spacing:0.5px;">LaaniPay</div>
                <div style="color:#d1fae5;font-size:12px;letter-spacing:1px;margin-top:2px;">ECOSYSTEM</div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px;color:#0f172a;font-size:15px;line-height:1.6;">
                ${body}
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-top:1px solid #e8eaf0;padding-top:20px;color:#64748b;font-size:12px;line-height:1.6;">
                      You received this email because of activity on your LaaniPay account.<br />
                      If this wasn't you, contact support at support@laanipay.ng.
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td>
    <a href="${href}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:10px;font-size:14px;">${label}</a>
  </td></tr></table>`;
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super('Email service is not configured');
    this.name = 'MailNotConfiguredError';
  }
}

async function sendMail({ to, subject, html, text }) {
  if (!env.resendApiKey) {
    console.warn(`[mail] RESEND_API_KEY not set — skipped "${subject}" to ${to}`);
    throw new MailNotConfiguredError();
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.mailFrom,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(env.mailReplyTo ? { reply_to: env.mailReplyTo } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      const msg = `Resend ${res.status}: ${body.slice(0, 300)}`;
      console.error(`[mail] ${msg}`);
      throw new Error(msg);
    }
    return true;
  } catch (err) {
    if (err instanceof MailNotConfiguredError) throw err;
    console.error('[mail] send failed:', err.message);
    throw err;
  }
}

export function sendVerificationEmail({ to, name, token }) {
  const link = `${env.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
  const html = layout(
    'Verify your email',
    `<p>Hello <strong>${name}</strong>,</p>
     <p>Welcome to LaaniPay. Please confirm your email address to secure your account and unlock the full ecosystem.</p>
     ${button(link, 'Verify email address')}
     <p style="font-size:13px;color:#64748b;">Or paste this link into your browser:<br /><span style="color:#0ea5e9;">${link}</span></p>
     <p style="font-size:13px;color:#64748b;">This link expires in 24 hours.</p>`,
  );
  return sendMail({
    to,
    subject: 'Verify your LaaniPay email',
    html,
    text: `Hello ${name},\n\nWelcome to LaaniPay. Confirm your email to secure your account:\n${link}\n\nThis link expires in 24 hours.`,
  });
}

export function sendWelcomeEmail({ to, name }) {
  return sendMail({
    to,
    subject: 'Email verified — welcome to LaaniPay',
    html: layout(
      'Email verified',
      `<p>Hello <strong>${name}</strong>,</p>
       <p>Your email has been verified successfully. You can now activate your account and start building your network.</p>
       ${button(env.frontendUrl + '/login', 'Login to your account')}`,
    ),
    text: `Hello ${name},\n\nYour email has been verified. Login at ${env.frontendUrl}/login`,
  });
}

export function sendLoginAlertEmail({ to, name, at, ip }) {
  return sendMail({
    to,
    subject: 'New sign-in to your LaaniPay account',
    html: layout(
      'New sign-in',
      `<p>Hello <strong>${name}</strong>,</p>
       <p>Your account was signed in to at <strong>${at}</strong>${ip ? ` from IP <strong>${ip}</strong>` : ''}.</p>
       <p style="font-size:13px;color:#64748b;">If this was you, no action is needed. If you don't recognise this sign-in, reset your password immediately and contact support.</p>`,
    ),
    text: `Hello ${name},\n\nYour account was signed in to at ${at}${ip ? ` from IP ${ip}` : ''}. If this wasn't you, contact support.`,
  });
}

export function sendActivationSuccessEmail({ to, name, bonuses }) {
  const bonusLines = (bonuses ?? [])
    .map((b) => `<li>${formatNaira(b.bonus)} — ${b.level === 1 ? 'direct' : `level ${b.level}`} bonus</li>`)
    .join('');
  return sendMail({
    to,
    subject: 'Your LaaniPay account is now active',
    html: layout(
      'Account activated',
      `<p>Hello <strong>${name}</strong>,</p>
       <p>Congratulations! Your account is now <strong>active</strong>. You've unlocked contributions, MLM earnings, and the full ecosystem.</p>
       ${bonuses ? `<p style="margin:16px 0 0;">Your team has earned:</p><ul>${bonusLines}</ul>` : ''}
       ${button(env.frontendUrl + '/dashboard', 'Go to dashboard')}`,
    ),
    text: `Hello ${name},\n\nYour account is now active. Welcome to the ecosystem.`,
  });
}

export function sendBonusReceivedEmail({ to, name, referrerName, bonus, level }) {
  const label = level === 1 ? 'direct referral' : `level ${level} referral`;
  return sendMail({
    to,
    subject: `${formatNaira(bonus)} bonus earned!`,
    html: layout(
      'Bonus received',
      `<p>Hello <strong>${name}</strong>,</p>
       <p>You just earned <strong style="color:#10b981;font-size:17px;">${formatNaira(bonus)}</strong> from a ${label} (${referrerName}).</p>
       <p>The amount has been credited to your wallet.</p>
       ${button(env.frontendUrl + '/dashboard', 'View your wallet')}`,
    ),
    text: `Hello ${name},\n\nYou earned ${formatNaira(bonus)} from a ${label}. Check your wallet.`,
  });
}

export function sendRankUpEmail({ to, name, rank }) {
  const label = rank.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return sendMail({
    to,
    subject: `You are now a ${label}!`,
    html: layout(
      'Rank up',
      `<p>Hello <strong>${name}</strong>,</p>
       <p>Amazing! You've reached the rank of <strong>${label}</strong>. Keep growing your team to unlock higher bonuses.</p>
       ${button(env.frontendUrl + '/mlm', 'View your MLM dashboard')}`,
    ),
    text: `Hello ${name},\n\nYou are now a ${label}. Congratulations!`,
  });
}

export function sendContributionSubscribedEmail({ to, name, planName, monthlyAmount, nextPaymentDate }) {
  return sendMail({
    to,
    subject: `Contribution plan activated: ${planName}`,
    html: layout(
      'Contribution started',
      `<p>Hello <strong>${name}</strong>,</p>
       <p>Your contribution plan is now active:</p>
       <ul>
         <li>Plan: <strong>${planName}</strong></li>
         <li>Monthly amount: <strong>${formatNaira(monthlyAmount)}</strong></li>
         <li>Next payment date: <strong>${nextPaymentDate}</strong></li>
       </ul>
       ${button(env.frontendUrl + '/contribution', 'Manage contributions')}`,
    ),
    text: `Hello ${name},\n\nYour ${planName} plan is active. Monthly amount: ${formatNaira(monthlyAmount)}.`,
  });
}

export function sendContributionReceiptEmail({ to, name, planName, amount, reference, nextPaymentDate }) {
  return sendMail({
    to,
    subject: `Contribution received: ${formatNaira(amount)}`,
    html: layout(
      'Contribution confirmed',
      `<p>Hello <strong>${name}</strong>,</p>
       <p>Your contribution of <strong>${formatNaira(amount)}</strong> for <strong>${planName}</strong> has been received and verified.</p>
       <p style="font-size:13px;color:#64748b;">Reference: ${reference}</p>
       <p>Next payment date: <strong>${nextPaymentDate}</strong></p>
       ${button(env.frontendUrl + '/contribution', 'View contributions')}`,
    ),
    text: `Hello ${name},\n\nYour ${formatNaira(amount)} contribution for ${planName} was received.`,
  });
}
