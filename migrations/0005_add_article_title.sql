-- ========================================
-- 🏛️ ADD ARTICLE TITLE FIELD
-- ========================================
-- Migration to add articleTitle field to criminal_violations table
-- This field will store the human-readable title of the criminal code article

-- Add articleTitle column to criminal_violations table
ALTER TABLE criminal_violations ADD COLUMN article_title TEXT;

-- Create index for better performance when querying by article title
CREATE INDEX idx_criminal_violations_article_title ON criminal_violations(article_title);

-- Update existing records with sample article titles
-- These are examples - in production, this would be populated by the analysis system
UPDATE criminal_violations SET article_title = 'Возбуждение ненависти либо вражды' WHERE article = 'Статья 282' OR article = '282';
UPDATE criminal_violations SET article_title = 'Оскорбление' WHERE article = 'Статья 130' OR article = '130';
UPDATE criminal_violations SET article_title = 'Оскорбление представителя власти' WHERE article = 'Статья 319' OR article = '319';
UPDATE criminal_violations SET article_title = 'Терроризм' WHERE article = 'Статья 205' OR article = '205';
UPDATE criminal_violations SET article_title = 'Убийство' WHERE article = 'Статья 105' OR article = '105';
UPDATE criminal_violations SET article_title = 'Кража' WHERE article = 'Статья 158' OR article = '158';
UPDATE criminal_violations SET article_title = 'Незаконные приобретение, хранение, перевозка наркотических средств' WHERE article = 'Статья 228' OR article = '228';
UPDATE criminal_violations SET article_title = 'Мошенничество' WHERE article = 'Статья 159' OR article = '159';