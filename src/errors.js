export class HttpError extends Error {
  constructor(status, code, message, { retryable = false, cause = undefined } = {}) {
    super(message, { cause });
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.expose = status < 500 || status === 502 || status === 503 || status === 504;
  }
}
