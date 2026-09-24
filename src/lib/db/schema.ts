import { sql } from "drizzle-orm";
import { pgTable, text, real, integer, jsonb, uuid, boolean, timestamp, bigint, primaryKey, unique, foreignKey, index, check } from "drizzle-orm/pg-core";

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
  thermalRenderMode: text("thermal_render_mode").notNull().default("native-v1"),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  formatId: text("format_id")
    .notNull()
    .references(() => formats.id),
  elements: jsonb("elements").notNull().default([]),
  archivedAt: text("archived_at"),
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

// Reusable design blocks saved globally. Saved as raw element configs (no format
// context), inserted as copies into any template.
export const globalElements = pgTable("global_elements", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  elements: jsonb("elements").notNull(),   // array of TemplateElement (no isStatic/fieldName enforced)
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

// Append-only print/export activity for a run. Kept separate from `runs`
// so progress (`printedCount`) stays fast and simple while reprints/sheet
// confirmations still leave an auditable trail.
export const runPrintEvents = pgTable("run_print_events", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  eventType: text("event_type").notNull(),
  output: text("output").notNull(),
  rangeFrom: integer("range_from").notNull(),
  rangeTo: integer("range_to").notNull(),
  labelCount: integer("label_count").notNull(),
  printedCountAfter: integer("printed_count_after"),
  printerName: text("printer_name"),
  message: text("message"),
  createdAt: text("created_at").notNull(),
});

// Office Pi durable queue. scripts/office/schema.sql installs these tables and
// their transactional state-machine functions without changing legacy records.
export const officeUsers = pgTable('office_users', {
  id: uuid('id').primaryKey(), username: text('username').notNull().unique(), passwordHash: text('password_hash').notNull(),
  canPrint: boolean('can_print').notNull().default(false), canEdit: boolean('can_edit').notNull().default(false),
  canControl: boolean('can_control').notNull().default(false),
  isAdmin: boolean('is_admin').notNull().default(false), disabled: boolean('disabled').notNull().default(false),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
export const officeSessions = pgTable('office_sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: uuid('user_id').notNull().references(()=>officeUsers.id),
  expiresAt: timestamp('expires_at',{withTimezone:true}).notNull(),
});
export const officeLoginAttempts = pgTable('office_login_attempts', {
  key: text('key').primaryKey(), attempts: integer('attempts').notNull(), windowStart: timestamp('window_start',{withTimezone:true}).notNull(),
});
export const officeStations = pgTable('office_stations', {
  id: text('id').primaryKey(), tokenHash: text('token_hash').unique(), revokedAt: timestamp('revoked_at',{withTimezone:true}),
  dispatchEnabled: boolean('dispatch_enabled').notNull().default(false), pairedAt: timestamp('paired_at',{withTimezone:true}),
  lastSeen: timestamp('last_seen',{withTimezone:true}), agentVersion: text('agent_version'), advertisedPrinters: jsonb('advertised_printers').notNull().default([]),
});
export const officePrinters = pgTable('office_printers', {
  stationId: text('station_id').notNull().references(()=>officeStations.id), id: text('id').notNull(), name: text('name').notNull(),
  serial: text('serial').notNull(), dpi: integer('dpi').notNull(), maxWidthDots: integer('max_width_dots').notNull(), enabled: boolean('enabled').notNull().default(true),
}, t=>[primaryKey({columns:[t.stationId,t.id]})]);
export const officePrinterAccess = pgTable('office_printer_access', {
  userId: uuid('user_id').notNull().references(()=>officeUsers.id), stationId: text('station_id').notNull(), printerId: text('printer_id').notNull(),
}, t=>[primaryKey({columns:[t.userId,t.stationId,t.printerId]}),foreignKey({columns:[t.stationId,t.printerId],foreignColumns:[officePrinters.stationId,officePrinters.id]})]);
export const officeRequests = pgTable('office_requests', {
  id: uuid('id').primaryKey(), requester: uuid('requester').notNull().references(()=>officeUsers.id), idempotencyKey: uuid('idempotency_key').notNull(),
  fingerprint: text('fingerprint').notNull(), runId: text('run_id').notNull().references(()=>runs.id), templateId: text('template_id').notNull().references(()=>templates.id),
  stationId: text('station_id').notNull(), printerId: text('printer_id').notNull(), rangeFrom: integer('range_from').notNull(), rangeTo: integer('range_to').notNull(),
  reprintOf: uuid('reprint_of'), reason: text('reason'), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
}, t=>[unique().on(t.requester,t.idempotencyKey),foreignKey({columns:[t.stationId,t.printerId],foreignColumns:[officePrinters.stationId,officePrinters.id]}),foreignKey({columns:[t.reprintOf],foreignColumns:[t.id]})]);
export const officeJobs = pgTable('office_jobs', {
  id: uuid('id').primaryKey(), requestId: uuid('request_id').notNull().references(()=>officeRequests.id), stationId: text('station_id').notNull(), printerId: text('printer_id').notNull(),
  sequence: bigint('sequence',{mode:'number'}).generatedAlwaysAsIdentity().unique(), rangeFrom: integer('range_from').notNull(), rangeTo: integer('range_to').notNull(),
  labelCount: integer('label_count').notNull(), payloadBase64: text('payload_base64').notNull(), sha256: text('sha256').notNull(), state: text('state').notNull().default('queued'),
  reviewRequired: boolean('review_required').notNull().default(false), reason: text('reason'), cupsJobId: integer('cups_job_id'),
  claimedAt: timestamp('claimed_at',{withTimezone:true}), submittedAt: timestamp('submitted_at',{withTimezone:true}), updatedAt: timestamp('updated_at',{withTimezone:true}).notNull().defaultNow(),
}, t=>[foreignKey({columns:[t.stationId,t.printerId],foreignColumns:[officePrinters.stationId,officePrinters.id]}),index('office_jobs_dispatch_idx').on(t.stationId,t.sequence),
  check('office_jobs_label_count_check',sql`${t.labelCount} BETWEEN 1 AND 25`),
  check('office_jobs_state_check',sql`${t.state} IN ('queued','claimed','submitted','sent_to_printer','rejected','needs_review','cancelled','resolved')`),
  check('office_jobs_payload_base64_check',sql`octet_length(decode(${t.payloadBase64},'base64')) BETWEEN 1 AND 2097152`)]);
export const officeEvents = pgTable('office_events', {
  eventId: uuid('event_id').primaryKey(), stationId: text('station_id').notNull(), jobId: uuid('job_id').notNull().references(()=>officeJobs.id),
  body: jsonb('body').notNull(), receivedAt: timestamp('received_at',{withTimezone:true}).notNull().defaultNow(),
});
export const officeReviews = pgTable('office_reviews', {
  id: bigint('id',{mode:'number'}).primaryKey().generatedAlwaysAsIdentity(), jobId: uuid('job_id').notNull().references(()=>officeJobs.id),
  operatorId: uuid('operator_id').references(()=>officeUsers.id), reason: text('reason').notNull(), detail: jsonb('detail'), createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});

export const officeControlStatus = pgTable('office_control_status', {
  stationId: text('station_id').notNull(), printerId: text('printer_id').notNull(), paused: boolean('paused'),
  receivedAt: timestamp('received_at',{withTimezone:true}).notNull(),
},t=>[primaryKey({columns:[t.stationId,t.printerId]}),foreignKey({columns:[t.stationId,t.printerId],foreignColumns:[officePrinters.stationId,officePrinters.id]})]);
export const officeControls = pgTable('office_controls', {
  id: uuid('id').primaryKey(), stationId: text('station_id').notNull(), printerId: text('printer_id').notNull(),
  requester: uuid('requester').notNull().references(()=>officeUsers.id), idempotencyKey: uuid('idempotency_key').notNull(), action: text('action').notNull(),
  createdAt: timestamp('created_at',{withTimezone:true}).notNull().defaultNow(), expiresAt: timestamp('expires_at',{withTimezone:true}).notNull().default(sql`now()+interval '60 seconds'`),
  claimedAt: timestamp('claimed_at',{withTimezone:true}), resolvedAt: timestamp('resolved_at',{withTimezone:true}), result: jsonb('result'),
},t=>[unique('office_controls_requester_key').on(t.requester,t.idempotencyKey),foreignKey({columns:[t.stationId,t.printerId],foreignColumns:[officePrinters.stationId,officePrinters.id]}),check('office_controls_action_check',sql`${t.action} IN ('pause','resume')`)]);
