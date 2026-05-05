CREATE TABLE "formats" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"width" real NOT NULL,
	"height" real NOT NULL,
	"dpi" integer,
	"labels_across" integer,
	"liner_width" real,
	"horizontal_gap_thermal" real,
	"side_margin_thermal" real,
	"label_gap" real,
	"sheet_width" real,
	"sheet_height" real,
	"columns" integer,
	"rows" integer,
	"labels_per_sheet" integer,
	"top_margin" real,
	"side_margin" real,
	"horizontal_gap" real,
	"vertical_gap" real,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "global_elements" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"elements" jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_presets" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"static_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"mapped_field" text,
	"csv_column" text,
	"last_used_at" text,
	"use_count" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"template_id" text NOT NULL,
	"preset_id" text,
	"static_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"field_mappings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_source" text DEFAULT 'paste' NOT NULL,
	"source_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mapped_field" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"total_labels" integer DEFAULT 0 NOT NULL,
	"printed_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"pinned_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"format_id" text NOT NULL,
	"elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_presets" ADD CONSTRAINT "run_presets_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_preset_id_run_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."run_presets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_format_id_formats_id_fk" FOREIGN KEY ("format_id") REFERENCES "public"."formats"("id") ON DELETE no action ON UPDATE no action;