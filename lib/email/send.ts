import { getFromEmail, getSmtpTransporter } from './smtp';
import { buildPasswordResetEmail, buildVerificationEmail } from './templates';

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

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verifyUrl = buildFrontendLink('/verify-email', token);
  const { subject, text, html } = buildVerificationEmail(verifyUrl);
  await sendEmail(to, subject, text, html);
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = buildFrontendLink('/reset-password', token);
  const { subject, text, html } = buildPasswordResetEmail(resetUrl);
  await sendEmail(to, subject, text, html);
}


