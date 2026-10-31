CREATE TABLE "rule_hits" (
	"handle" text NOT NULL,
	"rule_id" text NOT NULL,
	"day" text NOT NULL,
	"reporter" text NOT NULL,
	"net" text,
	"source" text NOT NULL,
	"category" text,
	"fingerprint" text,
	"x_user_id" text,
	"post_id" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "rule_hits_handle_rule_id_day_reporter_pk" PRIMARY KEY("handle","rule_id","day","reporter")
);
--> statement-breakpoint
CREATE INDEX "idx_rule_hits_rule_day" ON "rule_hits" USING btree ("rule_id","day");--> statement-breakpoint
CREATE INDEX "idx_rule_hits_day" ON "rule_hits" USING btree ("day");--> statement-breakpoint
CREATE INDEX "idx_rule_hits_fingerprint" ON "rule_hits" USING btree ("fingerprint") WHERE "rule_hits"."fingerprint" is not null;