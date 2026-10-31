CREATE TABLE "ai_account_votes" (
	"handle" text NOT NULL,
	"installation_id" text NOT NULL,
	"vote" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "ai_account_votes_handle_installation_id_pk" PRIMARY KEY("handle","installation_id"),
	CONSTRAINT "ck_ai_account_votes_vote" CHECK ("ai_account_votes"."vote" in ('ai', 'human'))
);
--> statement-breakpoint
CREATE INDEX "idx_ai_account_votes_handle" ON "ai_account_votes" USING btree ("handle","vote");