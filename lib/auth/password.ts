import * as argon2 from 'argon2';
import { randomBytes, randomInt } from 'crypto';

// Balanced: strong security, faster login/register (~200–500ms verify vs 1–3s with 64MB/3)
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // ~19 MiB (OWASP/argon2 default ballpark)
  timeCost: 2,
  parallelism: 4,
} satisfies argon2.Options;

/**
 * Hash a password using Argon2id
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(
  hash: string,
  password: string
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Generate a random token for email verification or password reset
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Generate a 6-digit OTP for email verification
 */
export function generateVerificationOtp(): string {
  return String(randomInt(100000, 1000000));
}




