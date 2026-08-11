-- Email verification OTP must live 10 minutes across serverless instances.
-- In-memory cache is not shared, so first OTP looked expired after a few seconds.
ALTER TABLE login.users
ADD COLUMN IF NOT EXISTS email_verification_expires TIMESTAMP NULL;
