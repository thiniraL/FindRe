export type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

export function buildVerificationEmail(verifyUrl: string): EmailContent {
  return {
    subject: 'Verify your email',
    text: `Verify your email by opening this link:\n\n${verifyUrl}\n\nIf you did not create an account, you can ignore this email.`,
    html: `
      <p>Verify your email by clicking this link:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>If you did not create an account, you can ignore this email.</p>
    `.trim(),
  };
}

/** 6-digit OTP only (no link) */
export function buildVerificationEmailWithOtp(otp: string): EmailContent {
  return {
    subject: 'Verify your email',
    text: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not create an account, you can ignore this email.`,
    html: `
      <p>Your verification code is: <strong>${otp}</strong></p>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not create an account, you can ignore this email.</p>
    `.trim(),
  };
}

export function buildPasswordResetEmail(resetUrl: string): EmailContent {
  return {
    subject: 'Reset your password',
    text: `Reset your password by opening this link:\n\n${resetUrl}\n\nIf you did not request a password reset, you can ignore this email.`,
    html: `
      <p>Reset your password by clicking this link:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>If you did not request a password reset, you can ignore this email.</p>
    `.trim(),
  };
}








