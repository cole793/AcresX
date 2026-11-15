// Account routes, called first by src/index.js (nothing here goes through the legacy worker.js):
// sign-in (accounts-auth.js), account data and share links (accounts-data.js), and the /r/<token>
// page that shows a shared report read-only. A database error answers 503 for that route only;
// the rest of the app is untouched, and the browser keeps working from localStorage.
import { handleAuthRoutes } from './accounts-auth.js';
import { handleDataRoutes } from './accounts-data.js';
import { noStore, TOKEN_PATTERN } from './accounts-store.js';

// The shared-report page: public/shared-report.html, which renders the report JSON with the same
// renderer as the printable report (public/property-report-v2.js). No HTML from users is stored or
// served. Scripts only from this site (no inline script runs), images only from here, data URLs
// (agent logo) and the Esri imagery the report map uses; the token never leaves in a Referer.
export const SHARED_PAGE_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://server.arcgisonline.com", "connect-src 'self'", "font-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'", "object-src 'none'"
].join('; ');

async function sharedPage(request, env) {
  const page = await env.ASSETS.fetch(new Request(new URL('/shared-report', request.url), { headers: { Accept: 'text/html' } }));
  const headers = new Headers(page.headers);
  headers.set('Content-Security-Policy', SHARED_PAGE_CSP);
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  return new Response(await page.text(), { status: page.ok ? 200 : page.status, headers });
}

export async function handleAccounts(request, env, ctx, url) {
  const isAccountApi = /^\/api\/(auth\/|me$|saved-properties|reports(\/|$)|branding$|account\/|shared\/)/.test(url.pathname);
  const shared = url.pathname.match(/^\/r\/([^/]+)\/?$/);
  if (!isAccountApi && !shared) return null;
  try {
    if (shared) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return noStore({ error: 'Not found.' }, 404);
      if (!TOKEN_PATTERN.test(shared[1])) return new Response('This shared report link is not valid.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
      return await sharedPage(request, env);
    }
    return (await handleAuthRoutes(request, env, ctx, url)) || (await handleDataRoutes(request, env, ctx, url)) || noStore({ error: 'Not found.' }, 404);
  } catch (error) {
    console.warn(JSON.stringify({ evt: 'accounts', path: url.pathname, ok: false, err: String(error?.message || error).slice(0, 200) }));
    return noStore({ error: 'Accounts are temporarily unavailable. Your work is still saved in this browser.' }, 503);
  }
}
