-- Kiosk mode: additive, idempotent tables. Applied only by scripts/kiosk/setup.mjs
-- (never at request time). Nothing here changes an existing table, function or
-- the office print queue rules (office_enqueue). Deleting a design or a run is
-- never blocked by these rows: they go with it (ON DELETE CASCADE).

-- Designs the owner marked "Use on kiosk".
CREATE TABLE IF NOT EXISTS kiosk_designs (
 template_id text PRIMARY KEY REFERENCES templates(id) ON DELETE CASCADE,
 added_by uuid REFERENCES office_users(id) ON DELETE SET NULL,
 added_at timestamptz NOT NULL DEFAULT now()
);

-- Accounts that sign in on the kiosk computer: they see only the kiosk.
CREATE TABLE IF NOT EXISTS kiosk_accounts (
 user_id uuid PRIMARY KEY REFERENCES office_users(id) ON DELETE CASCADE,
 added_at timestamptz NOT NULL DEFAULT now()
);

-- Product categories for designs (Flower, Pre-roll, Edible, Vape, Concentrate,
-- Shake/Trim, Other). On the kiosk a design with none is offered to no product
-- (New run still lists it).
CREATE TABLE IF NOT EXISTS template_categories (
 template_id text NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
 category text NOT NULL CHECK (category IN ('Flower','Pre-roll','Edible','Vape','Concentrate','Shake/Trim','Other')),
 PRIMARY KEY (template_id, category)
);

-- Brands a design is only for (optional). A design with none fits every brand
-- of its product kinds. Names as Manifest has them; compared without case.
CREATE TABLE IF NOT EXISTS template_brands (
 template_id text NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
 brand text NOT NULL CHECK (length(brand) BETWEEN 1 AND 100),
 PRIMARY KEY (template_id, brand)
);

-- Runs made at the kiosk: which product, how many, and where the 12-label
-- check stands (test printed, approved to print the rest, or stopped).
CREATE TABLE IF NOT EXISTS kiosk_runs (
 run_id text PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
 template_id text NOT NULL,
 user_id uuid REFERENCES office_users(id) ON DELETE SET NULL,
 package_key text NOT NULL,
 product_name text NOT NULL DEFAULT '',
 category text NOT NULL DEFAULT '',
 quantity integer NOT NULL CHECK (quantity >= 1),
 test_count integer NOT NULL CHECK (test_count >= 1),
 stage text NOT NULL DEFAULT 'test' CHECK (stage IN ('test','approved','stopped')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kiosk_runs_package_idx ON kiosk_runs(package_key, created_at DESC);
CREATE INDEX IF NOT EXISTS kiosk_runs_created_idx ON kiosk_runs(created_at DESC);
