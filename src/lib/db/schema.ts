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
