// Preserve the request and response streams, headers, status, and client IP.
// API credentials and handbook KV remain bound only to the backend Worker.
export function onRequest({ request, env }) {
  return env.CHAT_API.fetch(request);
}
