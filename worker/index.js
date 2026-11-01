// Cloudflare Workers entry point.
//
// The existing Express application (src/app.js) runs inside the Workers runtime
// through the official node:http integration (`httpServerHandler` from
// `cloudflare:node`), so the same routes, safety filter, retrieval, and SSE
// streaming code serve both the local Node server and the deployed Worker.
//
// Routing:
//   /api/*  -> Express (via httpServerHandler)
//   other   -> Workers Static Assets (public/), with an index.html fallback for
//              browser navigations that the local server used to serve through
//              Express.
//
// Configuration and bindings:
//   - Plain vars and secrets are available through process.env (Workers
//     populates it from bindings) and are read by src/config.
//   - HANDBOOK_INDEX (KV) holds the generated data/index.json; it is passed to
//     the shared code through setWorkerRuntime() and cached per isolate.
//   - ASSETS serves the frontend.
//
// The Express app is built lazily on the first API request instead of in the
// Worker's global scope. Two reasons: rate limiter stores start a timer when
// they are constructed (Workers disallow timers during global-scope startup),
// and startup time stays minimal for static-asset requests.
//
// There is no process startup/shutdown handling here: Workers have no sockets,
// so src/server.js (app.listen + graceful shutdown) is used only for local
// Node development.

import { httpServerHandler } from 'cloudflare:node';
import { setWorkerRuntime } from '../src/services/runtime.js';

// The port is a routing key inside the Worker (no socket is opened); it only
// has to match between app.listen() and httpServerHandler().
const PORT = 3000;

let expressHandlerPromise = null;

async function getExpressHandler() {
  if (!expressHandlerPromise) {
    expressHandlerPromise = (async () => {
      const { createApp } = await import('../src/app.js');
      const app = createApp();
      app.listen(PORT);
      const nodeHandler = httpServerHandler({ port: PORT });
      // httpServerHandler returns a Workers fetch handler; support both the
      // object shape ({ fetch }) and a plain function shape.
      return typeof nodeHandler === 'function'
        ? nodeHandler
        : nodeHandler.fetch.bind(nodeHandler);
    })().catch((error) => {
      // Allow the next request to retry instead of caching a broken state.
      expressHandlerPromise = null;
      throw error;
    });
  }
  return expressHandlerPromise;
}

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

async function serveStaticOrFallback(request, env) {
  if (!env || !env.ASSETS) {
    return new Response('Static assets are not configured for this Worker.', { status: 500 });
  }

  const response = await env.ASSETS.fetch(request);
  if (response.status === 404 && request.method === 'GET') {
    const accept = request.headers.get('accept') || '';
    if (accept.includes('text/html')) {
      // The local Express server answers browser navigations with index.html;
      // keep that behaviour so reloads and deep links reach the app shell.
      const indexUrl = new URL('/index.html', request.url);
      return env.ASSETS.fetch(
        new Request(indexUrl, { method: 'GET', headers: request.headers })
      );
    }
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    // KV and static-asset bindings only exist per request; hand them to the
    // shared services before dispatching.
    setWorkerRuntime({
      kv: (env && env.HANDBOOK_INDEX) || null,
      assets: (env && env.ASSETS) || null,
    });

    const url = new URL(request.url);
    if (isApiPath(url.pathname)) {
      const dispatchToExpress = await getExpressHandler();
      return dispatchToExpress(request, env, ctx);
    }
    return serveStaticOrFallback(request, env);
  },
};
