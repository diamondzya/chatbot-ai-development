/**
 * Pages Function: proxy every /api/* request to the deployed Cloudflare Worker.
 *
 * Cloudflare Pages is static-only hosting and its Functions runtime does not
 * implement node:http servers (`app.listen` throws "[unenv] http.createServer
 * is not implemented yet!"), so the Express backend cannot run here. The
 * Worker deployment (worker/index.js + src/, with the handbook index in the
 * HANDBOOK_INDEX KV namespace) is the single backend; this function forwards
 * API traffic to it so the pages.dev address works as a front door while
 * Pages serves the static frontend directly.
 *
 * Notes:
 * - DEFAULT_UPSTREAM is the Worker created by `npx wrangler deploy` on the
 *   main branch. Override it with a Pages environment variable named
 *   API_UPSTREAM if the Worker is renamed.
 * - Cross-origin POSTs are rejected here (same as the Worker's own guard),
 *   then the Origin header is removed before forwarding, because the Worker
 *   compares Origin with its own host.
 * - SSE streaming responses (`/api/chat/stream`) pass through untouched.
 */

const DEFAULT_UPSTREAM = 'https://sti-assist-ai.cyrusmadriaga325.workers.dev';

const STRIPPED_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Mirror the Worker's same-origin write guard before the header is removed.
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) {
    return new Response(
      JSON.stringify({
        error: {
          code: 'cross_origin_blocked',
          message: 'Cross-origin requests are not allowed.',
        },
      }),
      { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } }
    );
  }

  const upstreamBase = (env && env.API_UPSTREAM) || DEFAULT_UPSTREAM;
  const target = new URL(url.pathname + url.search, upstreamBase);

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('origin');

  // Bodies are small (48 KB JSON limit) and image uploads are disabled on the
  // Worker deployment, so buffering is simpler than streaming the request.
  const hasBody = !['GET', 'HEAD'].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : undefined;

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const name of STRIPPED_RESPONSE_HEADERS) responseHeaders.delete(name);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
