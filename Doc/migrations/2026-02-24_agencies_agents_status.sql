-- Add status column to business.AGENCIES and business.AGENTS.
-- Default 'Active'; existing rows get 'Active' via the DEFAULT.

-- business.AGENCIES
ALTER TABLE business.AGENCIES
ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'Active';

-- business.AGENTS
ALTER TABLE business.AGENTS
ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'Active';
