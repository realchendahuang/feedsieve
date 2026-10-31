CREATE TABLE "profile_accounts" (
	"handle" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"avatar_url" text,
	"verified" integer,
	"followers" bigint,
	"following_count" bigint,
	"tweets" bigint,
	"joined_at" bigint,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "ck_profile_accounts_verified" CHECK ("profile_accounts"."verified" is null or "profile_accounts"."verified" in (0, 1))
);
--> statement-breakpoint
CREATE TABLE "profile_posts" (
	"post_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"created_at" bigint NOT NULL,
	"kind" text,
	"media" text,
	"pinned" integer,
	"snippet" text,
	"media_url" text,
	"lang" text,
	"views" bigint,
	"likes" bigint,
	"retweets" bigint,
	"replies" bigint,
	"quotes" bigint,
	"bookmarks" bigint,
	"first_seen" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "ck_profile_posts_kind" CHECK ("profile_posts"."kind" is null or "profile_posts"."kind" in ('original', 'reply', 'quote')),
	CONSTRAINT "ck_profile_posts_media" CHECK ("profile_posts"."media" is null or "profile_posts"."media" in ('none', 'photo', 'video', 'gif', 'mixed')),
	CONSTRAINT "ck_profile_posts_pinned" CHECK ("profile_posts"."pinned" is null or "profile_posts"."pinned" in (0, 1))
);
--> statement-breakpoint
CREATE INDEX "idx_profile_posts_handle_updated" ON "profile_posts" USING btree ("handle","updated_at");