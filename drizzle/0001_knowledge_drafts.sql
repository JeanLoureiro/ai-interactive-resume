CREATE TABLE "knowledge_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"units" jsonb NOT NULL,
	"report" jsonb NOT NULL,
	"file_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
