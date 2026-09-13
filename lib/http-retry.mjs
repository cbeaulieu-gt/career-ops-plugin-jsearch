const DEFAULTS = { retries: 2, baseDelayMs: 500, maxDelayMs: 8000 };
const JITTER_MS = 250;
const NETWORK_CODES = /^(EAI_AGAIN|ECONNREFUSED|ECONNRESET|ENETUNREACH|ENOTFOUND|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_SOCKET)$/;

export function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

export function isNetworkError(error) {
  if (error?.name === 'AbortError') return true;
  if (NETWORK_CODES.test(String(error?.code || error?.cause?.code || ''))) return true;
  return error instanceof TypeError && error?.cause?.message !== 'unexpected redirect';
}

function isRetryableError(error) {
  if (error?.status === 429) return true;
  if (typeof error?.status === 'number' && error.status >= 500) return true;
  if (error?.status === undefined && error instanceof TypeError && error?.cause?.message === 'unexpected redirect') return false;
  return error?.status === undefined;
}

export async function fetchJsonWithRetry(ctx, url, opts = {}, policy = {}) {
  const settings = { ...DEFAULTS, isRetryable: isRetryableError, ...policy };
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ctx.fetchJson(url, opts);
    } catch (error) {
      if (error && (typeof error === 'object' || typeof error === 'function')) error.attempts = attempt + 1;
      if (attempt === settings.retries || !settings.isRetryable(error)) throw error;

      const retryAfter = parseRetryAfterMs(error?.retryAfter);
      const jitter = Math.min(JITTER_MS, Math.max(0, settings.maxDelayMs));
      const ceiling = Math.max(0, settings.maxDelayMs - jitter);
      const backoff = Math.min(settings.baseDelayMs * 2 ** attempt, ceiling);
      const delay = retryAfter === null
        ? backoff + Math.random() * jitter
        : Math.min(retryAfter, settings.maxDelayMs * 4);
      await (typeof ctx.sleep === 'function' ? ctx.sleep(delay) : new Promise((resolve) => setTimeout(resolve, delay)));
    }
  }
}
