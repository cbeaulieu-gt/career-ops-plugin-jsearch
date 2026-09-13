import { strict as assert } from 'node:assert';

import { normalizeUrl } from '../lib/normalize-url.mjs';
import {
  fetchJsonWithRetry,
  isNetworkError,
  parseRetryAfterMs,
} from '../lib/http-retry.mjs';

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

test('normalizeUrl strips known tracking without collapsing functional parameters', () => {
  assert.equal(
    normalizeUrl('http://JOBS.EXAMPLE.COM/role/?utm_source=x&job=42#apply'),
    'https://jobs.example.com/role?job=42',
  );
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
});

test('normalizeUrl promotes the MokaHR job fragment before removing it', () => {
  assert.equal(
    normalizeUrl('https://app.mokahr.com/acme#/job/role%2F42?utm_source=x'),
    'https://app.mokahr.com/acme?mokahr_job_id=role%2F42',
  );
});

test('parseRetryAfterMs handles delta seconds and rejects invalid values', () => {
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs('not-a-date'), null);
});

test('parseRetryAfterMs handles future and expired HTTP dates', () => {
  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    assert.equal(parseRetryAfterMs('Tue, 14 Nov 2023 22:13:25 GMT'), 5000);
    assert.equal(parseRetryAfterMs('Tue, 14 Nov 2023 22:13:15 GMT'), 0);
  } finally {
    Date.now = originalNow;
  }
});

test('isNetworkError recognizes DNS, timeout, and ordinary fetch failures only', () => {
  assert.equal(isNetworkError(Object.assign(new Error('not found'), { code: 'ENOTFOUND' })), true);
  assert.equal(isNetworkError(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })), true);
  assert.equal(isNetworkError(new TypeError('fetch failed')), true);
  assert.equal(isNetworkError(new SyntaxError('invalid JSON')), false);
});

test('fetchJsonWithRetry retries transient failures and honors Retry-After', async () => {
  let attempts = 0;
  const sleeps = [];
  const ctx = {
    sleep: async (ms) => sleeps.push(ms),
    fetchJson: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('HTTP 429'), { status: 429, retryAfter: '2' });
      return { status: 'OK' };
    },
  };
  assert.deepEqual(await fetchJsonWithRetry(ctx, 'https://example.com', {}, {
    isRetryable: (error) => error.status === 429,
  }), { status: 'OK' });
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('fetchJsonWithRetry retries 5xx errors with injected jitter', async () => {
  let attempts = 0;
  const sleeps = [];
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const value = await fetchJsonWithRetry({
      sleep: async (ms) => sleeps.push(ms),
      fetchJson: async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('HTTP 503'), { status: 503 });
        return 'recovered';
      },
    }, 'https://example.com');
    assert.equal(value, 'recovered');
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [625]);
});

test('fetchJsonWithRetry retries a statusless network failure', async () => {
  let attempts = 0;
  const sleeps = [];
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const value = await fetchJsonWithRetry({
      sleep: async (ms) => sleeps.push(ms),
      fetchJson: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('fetch failed');
        return 'recovered';
      },
    }, 'https://example.com');
    assert.equal(value, 'recovered');
  } finally {
    Math.random = originalRandom;
  }
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [500]);
});

test('fetchJsonWithRetry bounds fractional retry policies like the core helper', async () => {
  let attempts = 0;
  const failure = Object.assign(new Error('HTTP 503'), { status: 503 });
  await assert.rejects(
    () => fetchJsonWithRetry({
      sleep: async () => {},
      fetchJson: async () => {
        attempts += 1;
        throw failure;
      },
    }, 'https://example.com', {}, { retries: 1.5 }),
    (error) => error === failure && error.attempts === 2,
  );
  assert.equal(attempts, 2);
});

test('fetchJsonWithRetry does not start malformed or negative retry policies', async () => {
  for (const retries of ['invalid', -1]) {
    let attempts = 0;
    await assert.rejects(
      () => fetchJsonWithRetry({
        fetchJson: async () => {
          attempts += 1;
          throw Object.assign(new Error('HTTP 503'), { status: 503 });
        },
      }, 'https://example.com', {}, { retries }),
      (error) => error === undefined,
    );
    assert.equal(attempts, 0);
  }
});

test('fetchJsonWithRetry propagates non-retryable and primitive failures safely', async () => {
  const clientError = Object.assign(new Error('HTTP 400'), { status: 400 });
  await assert.rejects(
    () => fetchJsonWithRetry({ fetchJson: async () => { throw clientError; } }, 'https://example.com'),
    (error) => error === clientError && error.attempts === 1,
  );

  await assert.rejects(
    () => fetchJsonWithRetry({ fetchJson: async () => { throw 'connection lost'; } }, 'https://example.com', {}, { retries: 0 }),
    (error) => error === 'connection lost',
  );
});

for (const { name, run } of tests) {
  await run();
  console.log(`✓ ${name}`);
}

console.log(`✓ ${tests.length} helper tests passed`);
