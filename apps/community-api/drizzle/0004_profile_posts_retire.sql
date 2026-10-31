-- 主页帖子库换紧凑表结构（见 0005）：旧表先改名留着，0005 把数据搬过去后再删
ALTER TABLE "profile_posts" RENAME TO "profile_posts_old";--> statement-breakpoint
ALTER INDEX "idx_profile_posts_handle_updated" RENAME TO "idx_profile_posts_old_handle_updated";--> statement-breakpoint
ALTER TABLE "profile_posts_old" RENAME CONSTRAINT "profile_posts_pkey" TO "profile_posts_old_pkey";--> statement-breakpoint
ALTER TABLE "profile_posts_old" RENAME CONSTRAINT "ck_profile_posts_kind" TO "ck_profile_posts_old_kind";--> statement-breakpoint
ALTER TABLE "profile_posts_old" RENAME CONSTRAINT "ck_profile_posts_media" TO "ck_profile_posts_old_media";--> statement-breakpoint
ALTER TABLE "profile_posts_old" RENAME CONSTRAINT "ck_profile_posts_pinned" TO "ck_profile_posts_old_pinned";
