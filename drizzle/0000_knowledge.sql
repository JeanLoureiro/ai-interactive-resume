CREATE TABLE "conflicts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"unit_ids" text[] NOT NULL,
	"resolution_note" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_units" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"unit_type" text NOT NULL,
	"title" text NOT NULL,
	"text" text NOT NULL,
	"employer" text,
	"date_start" text,
	"date_end" text,
	"link" text,
	"retrieved_at" text NOT NULL,
	"position" integer NOT NULL
);
