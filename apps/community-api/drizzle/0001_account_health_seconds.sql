-- cron 探活曾把毫秒写进 account_health 的秒级时间列（上报路径写的是秒），统一换算成秒。
-- 1e11 秒约是公元 5138 年，任何大于它的值只可能是毫秒。
UPDATE "account_health" SET "updated_at" = "updated_at" / 1000 WHERE "updated_at" > 100000000000;--> statement-breakpoint
UPDATE "account_health" SET "confirmed_alive_at" = "confirmed_alive_at" / 1000 WHERE "confirmed_alive_at" > 100000000000;--> statement-breakpoint
UPDATE "account_health" SET "terminal_checked_at" = "terminal_checked_at" / 1000 WHERE "terminal_checked_at" > 100000000000;
