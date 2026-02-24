import { getFromEmail, getSmtpTransporter } from './smtp';
import { buildPasswordResetEmail, buildPasswordResetEmailWithOtp, buildVerificationEmail, buildVerificationEmailWithOtp } from './templates';

/** Format email/SMTP errors for logging (message, code, SMTP response) */
export function formatEmailError(err: unknown): string {
  if (err instanceof Error) {
    const extra: string[] = [];
    const r = err as Error & { code?: string; response?: string; responseCode?: number };
    if (r.code) extra.push(`code=${r.code}`);
    if (r.responseCode) extra.push(`responseCode=${r.responseCode}`);
    if (r.response) extra.push(`response=${String(r.response).slice(0, 200)}`);
    return extra.length ? `${err.message} (${extra.join(', ')})` : err.message;
  }
  return String(err);
}

function getFrontendBaseUrl(): URL {
  const raw = process.env.FRONTEND_URL;
  if (!raw) throw new Error('Missing FRONTEND_URL environment variable');
  try {
    return new URL(raw);
  } catch {
    throw new Error('Invalid FRONTEND_URL. It must include protocol, e.g. https://example.com');
  }
}

function buildFrontendLink(pathname: string, token: string): string {
  const base = getFrontendBaseUrl();
  const url = new URL(pathname, base);
  url.searchParams.set('token', token);
  return url.toString();
}

async function sendEmail(to: string, subject: string, text: string, html: string): Promise<void> {
  const transporter = getSmtpTransporter();
  const from = getFromEmail();

  console.info('Sending email', { to, from, subject });
  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });
    console.info('Email sent', { to, subject });
  } catch (err) {
    console.error('Email send failed', { to, subject, error: formatEmailError(err) });
    throw err;
  }
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verifyUrl = buildFrontendLink('/verify-email', token);
  const { subject, text, html } = buildVerificationEmail(verifyUrl);
  await sendEmail(to, subject, text, html);
}

/** Send verification email with 6-digit OTP only (no link) */
export async function sendVerificationEmailWithOtp(to: string, otp: string): Promise<void> {
  const { subject, text, html } = buildVerificationEmailWithOtp(otp);
  await sendEmail(to, subject, text, html);
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = buildFrontendLink('/reset-password', token);
  const { subject, text, html } = buildPasswordResetEmail(resetUrl);
  await sendEmail(to, subject, text, html);
}

/** Send password reset email with 6-digit code only (no link) */
export async function sendPasswordResetEmailWithOtp(to: string, otp: string): Promise<void> {
  const { subject, text, html } = buildPasswordResetEmailWithOtp(otp);
  await sendEmail(to, subject, text, html);
}








