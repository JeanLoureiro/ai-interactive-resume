CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"questions_asked" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "invites_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "invite_id" text;