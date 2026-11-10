import type { NextRequest } from 'next/server';
import { requireUser, type OfficeUser } from './auth';
import { failure, OfficeError } from './http';

/**
 * Permission a library route needs. Without an explicit value, GET/HEAD need
 * `read` and every other method needs `edit` (unchanged default).
 * `print-or-edit` is for recording printing work (run progress, print
 * history): an account that may print or edit may record it.
 */
export type RoutePermission = 'read' | 'print' | 'edit' | 'print-or-edit';
const users = new WeakMap<Request, OfficeUser>();
/** The authenticated user for a request that passed withOfficeAuth. */
export function officeUserFor(req: Request): OfficeUser | undefined { return users.get(req); }

// Authorization is performed in each data handler, not just in page routing.
export function withOfficeAuth<A extends unknown[]>(handler: (req: NextRequest, ...args: A) => Promise<Response>, permission?: RoutePermission) {
  return async (req: NextRequest, ...args: A) => {
    try {
      const needed = permission ?? (['GET','HEAD'].includes(req.method) ? 'read' : 'edit');
      const user = await requireUser(req, needed === 'print-or-edit' ? 'read' : needed);
      if (needed === 'print-or-edit' && !user.can_print && !user.can_edit) throw new OfficeError('Your account does not have permission', 403);
      users.set(req, user);
      const response = await handler(req, ...args);
      response.headers.set('Cache-Control','no-store');
      return response;
    } catch (error) { return failure(error); }
  };
}
