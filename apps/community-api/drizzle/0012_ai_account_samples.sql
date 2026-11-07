CREATE TABLE "ai_account_samples" (
	"handle" text NOT NULL,
	"tweet_id" text NOT NULL,
	"parent_id" text,
	"text" text NOT NULL,
	"parent_text" text,
	"posted_at" bigint,
	"gap_seconds" integer,
	"source" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "ai_account_samples_handle_tweet_id_pk" PRIMARY KEY("handle","tweet_id")
);
--> statement-breakpoint
CREATE INDEX "idx_ai_account_samples_handle" ON "ai_account_samples" USING btree ("handle","created_at" DESC NULLS LAST);