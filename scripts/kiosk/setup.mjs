// Kiosk mode setup: a trusted local operator CLI, like scripts/office/admin.mjs.
// Nothing touches the database without --yes; without it each command only
// prints what it would do. The generated password goes to a restricted file
// only (never the terminal), next to the office account files.
//
//   node scripts/kiosk/setup.mjs schema --yes
//       Applies scripts/kiosk/schema.sql (new tables only, IF NOT EXISTS).
//   node scripts/kiosk/setup.mjs create-account USERNAME --yes
//       Creates the shared kiosk sign-in: a print-only office account (no
//       editing, not an admin) with access to the office printer, marked as a
//       kiosk account.
//   node scripts/kiosk/setup.mjs all USERNAME --yes
//       Both, in that order.
//   node scripts/kiosk/setup.mjs status
//       Read-only: whether the kiosk tables exist and which accounts are kiosk accounts.
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
import { statements } from '../office/sql-statements.mjs';
import { neon } from '@neondatabase/serverless';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

const STATION = 'office-zebra-pi';
const PRINTER = 'black-zebra';
const [command, arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const confirmed = process.argv.includes('--yes');

async function secretFile(name, value) {
  const dir = resolve(process.cwd(), '../private/office-printing');
  await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  const file = resolve(dir, name); await writeFile(file, value, { mode: 0o600, flag: 'wx' }); return file;
}
function db() {
  loadEnvConfig(process.cwd(), false);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  return neon(process.env.DATABASE_URL);
}
async function applySchema() {
  const source = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  if (!confirmed) { console.log('Would apply scripts/kiosk/schema.sql: create tables kiosk_designs, kiosk_accounts, template_categories, kiosk_runs (IF NOT EXISTS) and two indexes on kiosk_runs. Add --yes to apply.'); return; }
  const sql = db();
  await sql.transaction(statements(source).filter((s) => s.trim()).map((s) => sql.query(s)));
  console.log('Kiosk schema applied (additive).');
}
async function createAccount(username) {
  if (!username || !/^[a-z0-9._@+-]{1,100}$/.test(username)) throw new Error('Supply a lowercase username, e.g. kiosk.');
  if (!confirmed) { console.log(`Would create office account "${username}" (can print only: no editing, not an admin), give it the office printer (${STATION}/${PRINTER}), mark it as a kiosk account, and write its password to ../private/office-printing/account-${username}.txt. Add --yes to do it.`); return; }
  const sql = db();
  const exists = await sql`SELECT id FROM office_users WHERE username=${username}`;
  if (exists.length) throw new Error('That username is taken. Choose another, or mark an existing print-only account by hand.');
  const printer = await sql`SELECT 1 FROM office_printers WHERE station_id=${STATION} AND id=${PRINTER}`;
  if (!printer.length) throw new Error('The office printer is not set up yet (scripts/office/admin.mjs provision-station).');
  const password = randomBytes(24).toString('base64url'); const salt = randomBytes(16).toString('hex');
  const verifier = salt + ':' + scryptSync(password, salt, 64).toString('hex');
  // The file first (it refuses to overwrite), so a password is never lost.
  const file = await secretFile('account-' + username + '.txt', 'Username: ' + username + '\nPassword: ' + password + '\nKiosk account: sees only the kiosk, can only print.\n');
  const id = randomUUID();
  await sql.transaction([
    sql`INSERT INTO office_users(id,username,password_hash,can_print,can_edit,is_admin) VALUES(${id},${username},${verifier},true,false,false)`,
    sql`INSERT INTO office_printer_access(user_id,station_id,printer_id) VALUES(${id},${STATION},${PRINTER})`,
    sql`INSERT INTO kiosk_accounts(user_id) VALUES(${id})`,
  ]);
  console.log(file);
}
try {
  if (command === 'schema') await applySchema();
  else if (command === 'create-account') await createAccount(arg);
  else if (command === 'all') { await applySchema(); await createAccount(arg); }
  else if (command === 'status') {
    const sql = db();
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_name IN ('kiosk_designs','kiosk_accounts','template_categories','kiosk_runs') ORDER BY 1`;
    console.log('Kiosk tables:', tables.map((t) => t.table_name).join(', ') || 'none yet');
    if (tables.some((t) => t.table_name === 'kiosk_accounts')) console.log(JSON.stringify(await sql`SELECT u.username,u.can_print,u.can_edit,u.is_admin,u.disabled FROM kiosk_accounts k JOIN office_users u ON u.id=k.user_id`));
  } else throw new Error('Commands: schema --yes, create-account USERNAME --yes, all USERNAME --yes, status');
} catch (error) { console.error(error.message); process.exitCode = 1; }
