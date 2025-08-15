-- ========================================
-- 🏛️ ADD SUBARTICLE FIELD
-- ========================================
-- Migration to add subarticle field to criminal_violations table
-- This field will store the subarticle number (e.g., "1" for "282.1")

-- Add subarticle column to criminal_violations table
ALTER TABLE criminal_violations ADD COLUMN subarticle TEXT;

-- Create index for better performance when querying by subarticle
CREATE INDEX idx_criminal_violations_subarticle ON criminal_violations(subarticle);

-- Create composite index for article + subarticle combination
CREATE INDEX idx_criminal_violations_article_subarticle ON criminal_violations(article, subarticle);

-- Update existing records to set subarticle to null (they don't have subarticle info)
UPDATE criminal_violations SET subarticle = NULL WHERE subarticle IS NULL;