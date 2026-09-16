import type { NextRequest } from 'next/server';
import { requireUser } from './auth';
import { failure } from './http';

// Authorization is performed in each data handler, not just in page routing.
export function withOfficeAuth<A extends unknown[]>(handler: (req: NextRequest, ...args: A) => Promise<Response>) {
  return async (req: NextRequest, ...args: A) => {
    try {
      await requireUser(req, ['GET','HEAD'].includes(req.method) ? 'read' : 'edit');
      const response = await handler(req, ...args);
      response.headers.set('Cache-Control','no-store');
      return response;
    } catch (error) { return failure(error); }
  };
}
