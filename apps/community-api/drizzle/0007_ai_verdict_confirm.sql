ALTER TABLE "ai_account_verdicts" ADD COLUMN "submitter" text;--> statement-breakpoint
ALTER TABLE "ai_account_verdicts" ADD COLUMN "confirmed" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_account_verdicts" ADD COLUMN "reviewed_at" bigint;--> statement-breakpoint
ALTER TABLE "ai_account_verdicts" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "ai_account_verdicts" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "ai_account_verdicts" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "ai_account_verdicts" ADD CONSTRAINT "ck_ai_account_verdicts_confirmed" CHECK ("ai_account_verdicts"."confirmed" in (0, 1));--> statement-breakpoint
-- 迁移前的判定都是维护者自己测的（上线第一天），直接视为已确认，避免主页 Tab 上的结论消失。
UPDATE "ai_account_verdicts" SET "confirmed" = 1;
