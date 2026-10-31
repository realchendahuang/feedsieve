ALTER TABLE "accounts" ADD COLUMN "listed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- 回填：先按「净票 ≥ 3 且没注销」近似；下一次快照发布按政策 v4 精确改写
UPDATE "accounts" a SET "listed" = 1
WHERE a."report_count" - a."rescue_count" >= 3
  AND NOT EXISTS (SELECT 1 FROM "account_health" h WHERE h."handle" = a."handle" AND h."state" = 'dead');
