import { pgTable, text, real, integer, jsonb } from "drizzle-orm/pg-core";

export const formats = pgTable("formats", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull(),
  width: real("width").notNull(),
  height: real("height").notNull(),
  dpi: integer("dpi"),
  labelsAcross: integer("labels_across"),
  linerWidth: real("liner_width"),
  horizontalGapThermal: real("horizontal_gap_thermal"),
  sideMarginThermal: real("side_margin_thermal"),
  labelGap: real("label_gap"),
  sheetWidth: real("sheet_width"),
  sheetHeight: real("sheet_height"),
  columns: integer("columns"),
  rows: integer("rows"),
  labelsPerSheet: integer("labels_per_sheet"),
  topMargin: real("top_margin"),
  sideMargin: real("side_margin"),
  horizontalGap: real("horizontal_gap"),
  verticalGap: real("vertical_gap"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  formatId: text("format_id")
    .notNull()
    .references(() => formats.id),
  elements: jsonb("elements").notNull().default([]),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Saved recipe for a repeating batch print job. Template + static field
// defaults + which field gets the variable CSV column. Reusing a preset
// lets a user skip re-filling the static fields every run.
export const runPresets = pgTable("run_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  templateId: text("template_id")
    .notNull()
    .references(() => templates.id),
  staticDefaults: jsonb("static_defaults").notNull().default({}),
  fieldMappings: jsonb("field_mappings").notNull().default({}),
  mappedField: text("mapped_field"),
  csvColumn: text("csv_column"),
  lastUsedAt: text("last_used_at"),
  useCount: integer("use_count").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// A single execution of a print run. Captures the template, static field
// values, the variable list (QR URLs), mapping, and progress. Persisting
// this lets us resume partial runs, reprint, and audit historical batches.
export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  templateId: text("template_id")
    .notNull()
    .references(() => templates.id),
  presetId: text("preset_id").references(() => runPresets.id),
  staticValues: jsonb("static_values").notNull().default({}),
  fieldMappings: jsonb("field_mappings").notNull().default({}),
  dataSource: text("data_source").notNull().default('paste'),
  sourceData: jsonb("source_data").notNull().default([]),
  mappedField: text("mapped_field"),
  status: text("status").notNull().default('draft'),
  totalLabels: integer("total_labels").notNull().default(0),
  printedCount: integer("printed_count").notNull().default(0),
  notes: text("notes"),
  // Pinned runs sort to the top of the Runs dashboard. Nullable text ISO
  // timestamp — null means not pinned. Sort order uses pinned_at DESC
  // among pinned, then created_at DESC for the rest.
  pinnedAt: text("pinned_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  completedAt: text("completed_at"),
});
