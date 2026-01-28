import nodemailer, { Transporter } from 'nodemailer';

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing ${key} environment variable`);
  return value;
}

function getSmtpPort(): number {
  const raw = getRequiredEnv('SMTP_PORT');
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid SMTP_PORT: "${raw}"`);
  }
  return port;
}

let cachedTransporter: Transporter | null = null;

export function getSmtpTransporter(): Transporter {
  if (cachedTransporter) return cachedTransporter;

  const host = getRequiredEnv('SMTP_HOST');
  const port = getSmtpPort();
  const user = getRequiredEnv('SMTP_USER');
  const pass = getRequiredEnv('SMTP_PASSWORD');

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587/25
    auth: { user, pass },
  });

  return cachedTransporter;
}

export function getFromEmail(): string {
  return getRequiredEnv('FROM_EMAIL');
}








