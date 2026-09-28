export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

// ---------------------------------------------------------------------------
// Branding (override via env)
// ---------------------------------------------------------------------------

const BRAND_COLOR = '#1E6FD9';
const TEXT_COLOR = '#1F2937';
const MUTED_COLOR = '#6B7280';
const BG_COLOR = '#F3F4F6';

function getBrandName(): string {
  return process.env.EMAIL_BRAND_NAME || 'FindRE';
}

/** Public base URL of this app (where public/ is served), e.g. https://api.yourdomain.com */
function getAppBaseUrl(): string | null {
  if (process.env.APP_URL) return process.env.APP_URL;
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercelHost ? `https://${vercelHost}` : null;
}

/**
 * Absolute URL of the logo PNG. EMAIL_LOGO_URL may be a full URL or just a path
 * (e.g. /email/logo.png, served from public/email/logo.png) which is resolved
 * against APP_URL. Email clients cannot load relative paths. Falls back to the
 * brand name as text.
 */
function getLogoUrl(): string | null {
  const value = process.env.EMAIL_LOGO_URL;
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const base = getAppBaseUrl();
  if (!base) {
    console.warn('EMAIL_LOGO_URL is a path but APP_URL is not set; logo will not be shown');
    return null;
  }
  try {
    return new URL(value, base).toString();
  } catch {
    console.warn('Invalid APP_URL / EMAIL_LOGO_URL; logo will not be shown', { base, value });
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

type LayoutOptions = {
  preheader: string;
  heading: string;
  intro: string;
  /** Main content block (code box or button) */
  body: string;
  footerNote: string;
};

function renderLayout({ preheader, heading, intro, body, footerNote }: LayoutOptions): string {
  const brand = escapeHtml(getBrandName());
  const logoUrl = getLogoUrl();
  const year = new Date().getFullYear();

  const logo = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${brand}" height="48" style="display:block;height:48px;width:auto;border:0;outline:none;text-decoration:none;" />`
    : `<span style="font-size:24px;font-weight:700;color:${BRAND_COLOR};letter-spacing:0.5px;">${brand}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BG_COLOR};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${BG_COLOR};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr>
            <td align="center" style="padding-bottom:24px;">${logo}</td>
          </tr>
          <tr>
            <td style="background-color:#FFFFFF;border-radius:12px;border-top:4px solid ${BRAND_COLOR};padding:40px 32px;">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:30px;font-weight:700;color:${TEXT_COLOR};">${escapeHtml(heading)}</h1>
              <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:${TEXT_COLOR};">${intro}</p>
              ${body}
              <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:${MUTED_COLOR};">${footerNote}</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 16px 0;font-size:12px;line-height:18px;color:${MUTED_COLOR};">
              This is an automated message, please do not reply.<br />
              &copy; ${year} ${brand}. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderCode(code: string, expiresText: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="background-color:#EFF6FF;border:1px dashed ${BRAND_COLOR};border-radius:8px;padding:20px;">
                    <div style="font-family:'Courier New',Courier,monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:8px;color:${BRAND_COLOR};">${escapeHtml(code)}</div>
                    <div style="margin-top:8px;font-size:13px;color:${MUTED_COLOR};">${escapeHtml(expiresText)}</div>
                  </td>
                </tr>
              </table>`;
}

function renderButton(url: string, label: string): string {
  const safeUrl = escapeHtml(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                <tr>
                  <td align="center" style="border-radius:8px;background-color:${BRAND_COLOR};">
                    <a href="${safeUrl}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:${MUTED_COLOR};word-break:break-all;">
                Or copy this link into your browser:<br />
                <a href="${safeUrl}" style="color:${BRAND_COLOR};">${safeUrl}</a>
              </p>`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function buildVerificationEmail(verifyUrl: string): EmailContent {
  const brand = getBrandName();
  return {
    subject: `Verify your ${brand} email`,
    text: `Welcome to ${brand}!\n\nVerify your email by opening this link:\n\n${verifyUrl}\n\nIf you did not create an account, you can ignore this email.`,
    html: renderLayout({
      preheader: `Confirm your email to finish setting up your ${brand} account.`,
      heading: 'Verify your email',
      intro: `Welcome to ${escapeHtml(brand)}! Please confirm your email address to finish setting up your account.`,
      body: renderButton(verifyUrl, 'Verify email'),
      footerNote: 'If you did not create an account, you can safely ignore this email.',
    }),
  };
}

/** 6-digit OTP only (no link) */
export function buildVerificationEmailWithOtp(otp: string): EmailContent {
  const brand = getBrandName();
  return {
    subject: `${otp} is your ${brand} verification code`,
    text: `Welcome to ${brand}!\n\nYour verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not create an account, you can ignore this email.`,
    html: renderLayout({
      preheader: `Your verification code is ${otp}. It expires in 10 minutes.`,
      heading: 'Verify your email',
      intro: `Welcome to ${escapeHtml(brand)}! Enter the code below in the app to verify your email address.`,
      body: renderCode(otp, 'This code expires in 10 minutes'),
      footerNote: 'If you did not create an account, you can safely ignore this email. Never share this code with anyone.',
    }),
  };
}

export function buildPasswordResetEmail(resetUrl: string): EmailContent {
  const brand = getBrandName();
  return {
    subject: `Reset your ${brand} password`,
    text: `Reset your password by opening this link:\n\n${resetUrl}\n\nIf you did not request a password reset, you can ignore this email.`,
    html: renderLayout({
      preheader: `Reset the password for your ${brand} account.`,
      heading: 'Reset your password',
      intro: 'We received a request to reset your password. Click the button below to choose a new one.',
      body: renderButton(resetUrl, 'Reset password'),
      footerNote: 'If you did not request a password reset, you can safely ignore this email. Your password will not change.',
    }),
  };
}

/** 6-digit code only (no link) for password reset */
export function buildPasswordResetEmailWithOtp(otp: string): EmailContent {
  const brand = getBrandName();
  return {
    subject: `${otp} is your ${brand} password reset code`,
    text: `Your password reset code is: ${otp}\n\nThis code expires in 15 minutes.\n\nIf you did not request a password reset, you can ignore this email.`,
    html: renderLayout({
      preheader: `Your password reset code is ${otp}. It expires in 15 minutes.`,
      heading: 'Reset your password',
      intro: 'We received a request to reset your password. Enter the code below in the app to continue.',
      body: renderCode(otp, 'This code expires in 15 minutes'),
      footerNote: 'If you did not request a password reset, you can safely ignore this email. Your password will not change. Never share this code with anyone.',
    }),
  };
}
