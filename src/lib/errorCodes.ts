/** Machine-readable error codes shared by browser-facing API responses and
 * the browser. Kept free of server imports so client code can use it. */

/** The request came from an address the server doesn't accept (a preview URL,
 * a new domain, or OFFICE_APP_ORIGIN set wrong). Fixable by opening the app at
 * its usual address, so the browser keeps the update instead of dropping it. */
export const ORIGIN_NOT_ALLOWED = 'origin_not_allowed';
