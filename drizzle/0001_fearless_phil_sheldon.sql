CREATE TABLE "run_print_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"event_type" text NOT NULL,
	"output" text NOT NULL,
	"range_from" integer NOT NULL,
	"range_to" integer NOT NULL,
	"label_count" integer NOT NULL,
	"printed_count_after" integer,
	"printer_name" text,
	"message" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_print_events" ADD CONSTRAINT "run_print_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;