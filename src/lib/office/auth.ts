import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { officeSql } from './db';
import { OfficeError, sameOrigin } from './http';

export const COOKIE = 'lw-office-session';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface OfficeUser { id: string; username: string; can_print: boolean; can_edit: boolean; is_admin: boolean }
export async function currentUser(): Promise<OfficeUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const sql = officeSql();
  const users = await sql`SELECT u.id,u.username,u.can_print,u.can_edit,u.is_admin FROM office_sessions s
    JOIN office_users u ON u.id=s.user_id WHERE s.token_hash=${hash(token)} AND s.expires_at>now() AND NOT u.disabled`;
  return users[0] as OfficeUser || null;
}
export async function requireUser(req: Request, permission: 'read' | 'print' | 'edit' | 'admin' = 'read') {
  if (!['GET','HEAD'].includes(req.method)) sameOrigin(req);
  const user = await currentUser();
  if (!user) throw new OfficeError('Sign in to Label Wrangler', 401);
  if ((permission === 'print' && !user.can_print) || (permission === 'edit' && !user.can_edit) || (permission === 'admin' && !user.is_admin)) {
    throw new OfficeError('Your account does not have permission', 403);
  }
  // This installation is one shared office workspace; authenticated office
  // membership grants its library access. Printer access is separately scoped.
  return user;
}
export async function requirePrinter(user: OfficeUser, station: string, printer: string) {
  const sql = officeSql();
  const rows = await sql`SELECT p.* FROM office_printers p JOIN office_printer_access a
   ON a.station_id=p.station_id AND a.printer_id=p.id WHERE a.user_id=${user.id}
   AND p.station_id=${station} AND p.id=${printer} AND p.enabled`;
  if (!rows.length) throw new OfficeError('Printer access denied', 403);
  return rows[0];
}
export async function requireStation(req: Request, station: unknown) {
  const token = req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if (!token || typeof station !== 'string') throw new OfficeError('Station authentication required', 401);
  const sql = officeSql();
  const rows = await sql`SELECT id FROM office_stations WHERE token_hash=${hash(token)} AND revoked_at IS NULL AND id=${station}`;
  if (!rows.length) throw new OfficeError('Invalid station credential', 401);
  return station;
}
export async function login(username: string, password: string) {
  const sql = officeSql();
  // Durable username throttle across instances. No IP/header trust required.
  const key = hash(username.toLowerCase());
  const attempts = await sql`INSERT INTO office_login_attempts(key,attempts,window_start) VALUES(${key},1,now())
   ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN office_login_attempts.window_start<now()-interval '15 minutes' THEN 1 ELSE office_login_attempts.attempts+1 END,
   window_start=CASE WHEN office_login_attempts.window_start<now()-interval '15 minutes' THEN now() ELSE office_login_attempts.window_start END RETURNING attempts`;
  if (attempts[0].attempts > 10) throw new OfficeError('Too many attempts. Try again in 15 minutes.', 429);
  const rows = await sql`SELECT * FROM office_users WHERE username=${username.toLowerCase()} AND NOT disabled`;
  const stored = rows[0]?.password_hash || '00000000000000000000000000000000:' + '00'.repeat(64);
  const [salt, expected] = stored.split(':');
  const actual = scryptSync(password, salt, 64);
  if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !rows.length) throw new OfficeError('Invalid username or password', 401);
  const token = randomBytes(32).toString('hex');
  await sql`INSERT INTO office_sessions(token_hash,user_id,expires_at) VALUES(${hash(token)},${rows[0].id},now()+interval '12 hours')`;
  await sql`DELETE FROM office_login_attempts WHERE key=${key}`;
  (await cookies()).set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 43200 });
  return { username: rows[0].username };
}
