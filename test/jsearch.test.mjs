import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import jsearch from '../index.mjs';

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

test('manifest declares the keyed RapidAPI provider security boundary', async () => {
  const manifestUrl = new URL('../manifest.json', import.meta.url);
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

  assert.equal(manifest.id, 'jsearch');
  assert.equal(manifest.apiVersion, 1);
  assert.deepEqual(manifest.hooks, ['provider']);
  assert.deepEqual(manifest.requiredEnv, ['JSEARCH_RAPIDAPI_KEY']);
  assert.deepEqual(manifest.allowedHosts, ['jsearch.p.rapidapi.com']);
  assert.equal(manifest.humanInTheLoop, true);
});

test('fetch builds filtered Search V2 requests and follows response cursors', async () => {
  const requests = [];
  const pages = [
    {
      status: 'OK',
      data: {
        jobs: Array.from({ length: 10 }, () => ({
          job_id: 'job-1',
          job_title: 'Machine Learning Lead',
          employer_name: 'Example AI',
          job_publisher: 'Example Careers',
          job_apply_link: 'https://jobs.example.com/1?utm_source=jsearch',
          job_location: 'Toronto, Ontario',
          job_description: 'Lead the applied ML group.',
          job_is_remote: true,
          job_posted_at_timestamp: 1787918400,
        })),
        cursor: 'cursor-page-2',
      },
    },
    {
      status: 'OK',
      data: {
        jobs: [{
          job_id: 'job-2',
          job_title: 'Director of AI',
          employer_name: 'Example Labs',
          job_publisher: 'LinkedIn',
          job_apply_link: 'https://jobs.example.com/2',
          job_location: 'Ottawa, Ontario',
          job_description: 'Build an AI organization.',
          job_is_remote: false,
          job_posted_at_datetime_utc: '2026-08-27T09:00:00Z',
        }],
        cursor: null,
      },
    },
  ];
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'scoped-key' }),
    fetchJson: async (url, options) => {
      requests.push({ url: new URL(url), options });
      return pages[requests.length - 1];
    },
  };

  const jobs = await jsearch.provider.fetch({
    name: 'JSearch Canada',
    query: 'AI leadership jobs in Toronto',
    country: 'ca',
    language: 'en',
    date_posted: 'week',
    employment_types: ['FULLTIME', 'CONTRACTOR'],
    job_requirements: ['more_than_3_years_experience', 'no_degree'],
    radius: 50,
    exclude_job_publishers: ['Dice', 'Monster'],
    fields: ['job_salary'],
    max_pages: 2,
  }, ctx);

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].url.href,
    'https://jsearch.p.rapidapi.com/search-v2?query=AI+leadership+jobs+in+Toronto&num_pages=1&country=ca&language=en&date_posted=week&employment_types=FULLTIME%2CCONTRACTOR&job_requirements=more_than_3_years_experience%2Cno_degree&radius=50&exclude_job_publishers=Dice%2CMonster&fields=job_salary%2Cjob_id%2Cjob_title%2Cemployer_name%2Cjob_publisher%2Cjob_apply_link%2Capply_options%2Cjob_google_link%2Cjob_location%2Cjob_description%2Cjob_is_remote%2Cjob_posted_at_timestamp%2Cjob_posted_at_datetime_utc',
  );
  assert.equal(requests[1].url.searchParams.get('cursor'), 'cursor-page-2');
  assert.deepEqual(requests[0].options.headers, {
    'X-RapidAPI-Key': 'scoped-key',
    'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
  });
  assert.deepEqual(jobs, [
    {
      id: 'job-1',
      title: 'Machine Learning Lead',
      url: 'https://jobs.example.com/1?utm_source=jsearch',
      company: 'Example AI',
      location: 'Toronto, Ontario, Remote',
      description: 'Lead the applied ML group.',
      publisher: 'Example Careers',
      remote: true,
      postedAt: 1787918400000,
    },
    {
      id: 'job-2',
      title: 'Director of AI',
      url: 'https://jobs.example.com/2',
      company: 'Example Labs',
      location: 'Ottawa, Ontario',
      description: 'Build an AI organization.',
      publisher: 'LinkedIn',
      remote: false,
      postedAt: Date.parse('2026-08-27T09:00:00Z'),
    },
  ]);
});

test('fetch skips the cursor when a raw page contains fewer than ten jobs', async () => {
  let requests = 0;
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async () => {
      requests += 1;
      return {
        status: 'OK',
        data: {
          jobs: Array.from({ length: 9 }, () => ({
            job_id: 'underfilled-page-job',
            job_title: 'Underfilled Page Result',
            job_apply_link: 'https://jobs.example.com/underfilled-page-job',
          })),
          cursor: 'unproductive-cursor',
        },
      };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs', max_pages: 2 }, ctx);

  assert.equal(requests, 1);
  assert.deepEqual(jobs.map((job) => job.id), ['underfilled-page-job']);
});

test('fetch runs independently configurable geographic and remote-only passes', async () => {
  const requests = [];
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async (url) => {
      requests.push(new URL(url));
      return {
        status: 'OK',
        data: {
          jobs: [{
            job_id: `job-${requests.length}`,
            job_title: requests.length === 1 ? 'Toronto Role' : 'Remote Role',
            employer_name: 'Example',
            job_publisher: 'Example Careers',
            job_apply_link: `https://jobs.example.com/${requests.length}`,
            job_is_remote: requests.length === 2,
          }],
          cursor: null,
        },
      };
    },
  };

  const both = await jsearch.provider.fetch({ query: 'AI jobs in Toronto', include_remote: true }, ctx);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].searchParams.has('work_from_home'), false);
  assert.equal(requests[1].searchParams.get('work_from_home'), 'true');
  assert.deepEqual(both.map((job) => job.title), ['Toronto Role', 'Remote Role']);

  requests.length = 0;
  const remoteOnly = await jsearch.provider.fetch({
    query: 'AI jobs',
    include_geo: false,
    include_remote: true,
  }, ctx);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].searchParams.get('work_from_home'), 'true');
  assert.deepEqual(remoteOnly.map((job) => job.title), ['Toronto Role']);

  requests.length = 0;
  const disabled = await jsearch.provider.fetch({
    query: 'AI jobs',
    include_geo: false,
    include_remote: false,
  }, ctx);
  assert.deepEqual(disabled, []);
  assert.equal(requests.length, 0);
});

test('fetch deduplicates combined passes by job id and canonical apply URL', async () => {
  const makeJob = (id, title, url) => ({
    job_id: id,
    job_title: title,
    employer_name: 'Example',
    job_publisher: 'Example Careers',
    job_apply_link: url,
  });
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async (url) => ({
      status: 'OK',
      data: {
        jobs: new URL(url).searchParams.has('work_from_home')
          ? [
              makeJob('shared-id', 'Shared duplicate by id', 'https://jobs.example.com/shared?utm_source=remote'),
              makeJob('url-second-id', 'Duplicate by URL', 'https://jobs.example.com/same?utm_campaign=remote'),
              makeJob('remote-only', 'Remote Only', 'https://jobs.example.com/remote'),
            ]
          : [
              makeJob('shared-id', 'Shared', 'https://jobs.example.com/shared?utm_source=geo'),
              makeJob('url-first-id', 'Canonical URL Winner', 'http://JOBS.EXAMPLE.COM/same/?utm_source=geo'),
            ],
        cursor: null,
      },
    }),
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs', include_remote: true }, ctx);

  assert.deepEqual(jobs.map((job) => job.title), [
    'Shared',
    'Canonical URL Winner',
    'Remote Only',
  ]);
});

test('fetch stops at the configured result budget before following another cursor', async () => {
  let requests = 0;
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async () => {
      requests += 1;
      return {
        status: 'OK',
        data: {
          jobs: Array.from({ length: 5 }, (_, index) => ({
            job_id: `job-${index + 1}`,
            job_title: `Role ${index + 1}`,
            employer_name: 'Example',
            job_publisher: 'Example Careers',
            job_apply_link: `https://jobs.example.com/${index + 1}`,
          })),
          cursor: 'another-page',
        },
      };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs', max_pages: 20, max_results: 3 }, ctx);

  assert.equal(requests, 1);
  assert.deepEqual(jobs.map((job) => job.id), ['job-1', 'job-2', 'job-3']);
});

test('duplicate rows do not consume the unique-result budget within a pass', async () => {
  const requests = [];
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async (url) => {
      requests.push(new URL(url));
      if (requests.length === 1) {
        return {
          status: 'OK',
          data: {
            jobs: Array.from({ length: 10 }, (_, index) => (
              index % 2 === 0 ? {
                job_id: 'duplicate',
                job_title: 'Duplicate',
                job_apply_link: 'https://jobs.example.com/duplicate?utm_source=one',
              } : {
                job_id: 'duplicate',
                job_title: 'Duplicate Again',
                job_apply_link: 'https://jobs.example.com/duplicate?utm_source=two',
              }
            )),
            cursor: 'page-two',
          },
        };
      }
      return {
        status: 'OK',
        data: {
          jobs: [{
            job_id: 'unique',
            job_title: 'Unique',
            job_apply_link: 'https://jobs.example.com/unique',
          }],
          cursor: null,
        },
      };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs', max_pages: 2, max_results: 2 }, ctx);

  assert.equal(requests.length, 2);
  assert.deepEqual(jobs.map((job) => job.id), ['duplicate', 'unique']);
});

test('duplicates from the remote pass do not consume its remaining unique-result budget', async () => {
  const requests = [];
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async (url) => {
      const requestUrl = new URL(url);
      requests.push(requestUrl);
      if (!requestUrl.searchParams.has('work_from_home')) {
        return {
          status: 'OK',
          data: {
            jobs: [{
              job_id: 'shared',
              job_title: 'Shared',
              job_apply_link: 'https://jobs.example.com/shared?utm_source=geo',
            }],
            cursor: null,
          },
        };
      }
      if (!requestUrl.searchParams.has('cursor')) {
        return {
          status: 'OK',
          data: {
            jobs: Array.from({ length: 10 }, () => ({
              job_id: 'shared',
              job_title: 'Shared Duplicate',
              job_apply_link: 'https://jobs.example.com/shared?utm_source=remote',
            })),
            cursor: 'remote-page-two',
          },
        };
      }
      return {
        status: 'OK',
        data: {
          jobs: [{
            job_id: 'remote-unique',
            job_title: 'Remote Unique',
            job_apply_link: 'https://jobs.example.com/remote-unique',
          }],
          cursor: null,
        },
      };
    },
  };

  const jobs = await jsearch.provider.fetch({
    query: 'AI jobs',
    include_remote: true,
    max_pages: 2,
    max_results: 2,
  }, ctx);

  assert.equal(requests.length, 3);
  assert.deepEqual(jobs.map((job) => job.id), ['shared', 'remote-unique']);
});

test('fetch requires the RapidAPI key from scoped plugin context', async (t) => {
  const previous = process.env.JSEARCH_RAPIDAPI_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.JSEARCH_RAPIDAPI_KEY;
    else process.env.JSEARCH_RAPIDAPI_KEY = previous;
  });
  process.env.JSEARCH_RAPIDAPI_KEY = 'global-key-must-not-be-read';

  await assert.rejects(
    jsearch.provider.fetch(
      { query: 'AI jobs' },
      { env: Object.freeze({}), fetchJson: async () => ({ data: { jobs: [] } }) },
    ),
    /JSEARCH_RAPIDAPI_KEY/,
  );
});

test('fetch surfaces API failures without exposing the RapidAPI key', async () => {
  for (const { status, retryAfter } of [
    { status: 401 },
    { status: 403 },
    { status: 429, retryAfter: '5' },
    { status: 502 },
  ]) {
    let attempts = 0;
    const ctx = {
      env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'sensitive-rapidapi-key' }),
      sleep: async () => {},
      fetchJson: async () => {
        attempts += 1;
        const error = new Error(`HTTP ${status} for X-RapidAPI-Key sensitive-rapidapi-key`);
        error.status = status;
        if (retryAfter) error.retryAfter = retryAfter;
        throw error;
      },
    };

    await assert.rejects(
      jsearch.provider.fetch({ query: 'AI jobs' }, ctx),
      (error) => {
        assert.equal(error.status, status);
        assert.equal(error.retryAfter, retryAfter);
        assert.match(error.message, new RegExp(`HTTP ${status}`));
        assert.doesNotMatch(error.message, /sensitive-rapidapi-key/);
        assert.equal(attempts, status === 429 || status >= 500 ? 3 : 1);
        if (status === 429 || status >= 500) assert.equal(error.attempts, 3);
        return true;
      },
    );
  }
});

test('fetch retries a rate limit and honors Retry-After before recovering', async () => {
  let attempts = 0;
  const sleepCalls = [];
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    sleep: async (ms) => sleepCalls.push(ms),
    fetchJson: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('HTTP 429');
        error.status = 429;
        error.retryAfter = '2';
        throw error;
      }
      return { status: 'OK', data: { jobs: [], cursor: null } };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs' }, ctx);

  assert.deepEqual(jobs, []);
  assert.equal(attempts, 2);
  assert.deepEqual(sleepCalls, [2000]);
});

test('fetch retries a network error and recovers', async () => {
  let attempts = 0;
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    sleep: async () => {},
    fetchJson: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('fetch failed');
      return { status: 'OK', data: { jobs: [], cursor: null } };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs' }, ctx);

  assert.deepEqual(jobs, []);
  assert.equal(attempts, 2);
});

test('fetch retries a DNS error wrapped by the guarded plugin transport', async () => {
  let attempts = 0;
  const dnsCause = Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' });
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    sleep: async () => {},
    fetchJson: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error(
          'plugin egress: cannot resolve jsearch.p.rapidapi.com — getaddrinfo EAI_AGAIN',
          { cause: dnsCause },
        );
      }
      return { status: 'OK', data: { jobs: [], cursor: null } };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs' }, ctx);

  assert.deepEqual(jobs, []);
  assert.equal(attempts, 2);
});

test('fetch does not retry a statusless non-network failure', async () => {
  let attempts = 0;
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    sleep: async () => {},
    fetchJson: async () => {
      attempts += 1;
      throw new SyntaxError('Unexpected token in JSON');
    },
  };

  await assert.rejects(
    () => jsearch.provider.fetch({ query: 'AI jobs' }, ctx),
    /Unexpected token in JSON/,
  );
  assert.equal(attempts, 1);
});

test('fetch honors an HTTP-date Retry-After within the bounded delay', async () => {
  let attempts = 0;
  const sleepCalls = [];
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    sleep: async (ms) => sleepCalls.push(ms),
    fetchJson: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('HTTP 429');
        error.status = 429;
        error.retryAfter = new Date(Date.now() + 60_000).toUTCString();
        throw error;
      }
      return { status: 'OK', data: { jobs: [], cursor: null } };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs' }, ctx);

  assert.deepEqual(jobs, []);
  assert.equal(attempts, 2);
  assert.deepEqual(sleepCalls, [32_000]);
});

test('radius is included only when explicitly set to a non-negative number', async () => {
  const radii = [
    { value: null, expected: null },
    { value: '', expected: null },
    { value: '   ', expected: null },
    { value: -1, expected: null },
    { value: 0, expected: '0' },
    { value: '25', expected: '25' },
  ];

  for (const { value, expected } of radii) {
    let requestUrl;
    const ctx = {
      env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
      fetchJson: async (url) => {
        requestUrl = new URL(url);
        return { status: 'OK', data: { jobs: [], cursor: null } };
      },
    };
    await jsearch.provider.fetch({ query: 'AI jobs', radius: value }, ctx);
    assert.equal(requestUrl.searchParams.get('radius'), expected);
  }
});

test('fetch rejects malformed or non-OK Search V2 payloads', async () => {
  const responses = [
    { status: 'OK', data: { jobs: null } },
    { status: 'ERROR', data: { jobs: [] } },
  ];
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async () => responses.shift(),
  };

  await assert.rejects(jsearch.provider.fetch({ query: 'AI jobs' }, ctx), /malformed Search V2 response/);
  await assert.rejects(jsearch.provider.fetch({ query: 'AI jobs' }, ctx), /malformed Search V2 response/);
});

test('normalization uses safe apply fallbacks and drops unusable results', async () => {
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async () => ({
      status: 'OK',
      data: {
        jobs: [
          {
            job_id: 'option-fallback',
            job_title: 'Option Fallback',
            employer_name: 'Example',
            job_publisher: 'Publisher',
            job_apply_link: 'javascript:alert(1)',
            apply_options: [
              { apply_link: 'data:text/plain,unsafe' },
              { apply_link: 'https://jobs.example.com/option' },
            ],
            job_location: 'Remote — Canada',
            job_is_remote: true,
            job_posted_at_timestamp: 'not-a-number',
            job_posted_at_datetime_utc: 'not-a-date',
          },
          {
            job_id: 'google-fallback',
            job_title: 'Google Fallback',
            employer_name: 'Example',
            job_publisher: 'Publisher',
            job_apply_link: 'file:///etc/passwd',
            apply_options: [{ apply_link: 'mailto:jobs@example.com' }],
            job_google_link: 'https://www.google.com/search?q=jobs#posting',
          },
          {
            job_id: 'unsafe',
            job_title: 'Unsafe',
            employer_name: 'Example',
            job_publisher: 'Publisher',
            job_apply_link: 'javascript:alert(1)',
          },
          { job_id: '', job_title: 'Missing ID', job_apply_link: 'https://jobs.example.com/no-id' },
          { job_id: 'missing-title', job_title: '', job_apply_link: 'https://jobs.example.com/no-title' },
        ],
        cursor: null,
      },
    }),
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs' }, ctx);

  assert.deepEqual(jobs, [
    {
      id: 'option-fallback',
      title: 'Option Fallback',
      url: 'https://jobs.example.com/option',
      company: 'Example',
      location: 'Remote — Canada',
      description: '',
      publisher: 'Publisher',
      remote: true,
    },
    {
      id: 'google-fallback',
      title: 'Google Fallback',
      url: 'https://www.google.com/search?q=jobs#posting',
      company: 'Example',
      location: '',
      description: '',
      publisher: 'Publisher',
      remote: false,
    },
  ]);
});

test('fetch enforces the twenty-page safety ceiling', async () => {
  let requests = 0;
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async () => {
      requests += 1;
      return {
        status: 'OK',
        data: {
          jobs: Array.from({ length: 10 }, () => ({
            job_id: `job-${requests}`,
            job_title: `Role ${requests}`,
            employer_name: 'Example',
            job_publisher: 'Example Careers',
            job_apply_link: `https://jobs.example.com/${requests}`,
          })),
          cursor: `cursor-${requests + 1}`,
        },
      };
    },
  };

  const jobs = await jsearch.provider.fetch({ query: 'AI jobs', max_pages: 500 }, ctx);

  assert.equal(requests, 20);
  assert.equal(jobs.length, 20);
});

test('fetch rejects a missing search query before making a request', async () => {
  let requests = 0;
  const ctx = {
    env: Object.freeze({ JSEARCH_RAPIDAPI_KEY: 'key' }),
    fetchJson: async () => {
      requests += 1;
      return { status: 'OK', data: { jobs: [], cursor: null } };
    },
  };

  await assert.rejects(
    jsearch.provider.fetch({ name: 'Missing query' }, ctx),
    /requires a non-empty 'query'/,
  );
  assert.equal(requests, 0);
});

for (const { name, run } of tests) {
  const cleanups = [];
  try {
    await run({ after(cleanup) { cleanups.push(cleanup); } });
    console.log(`✓ ${name}`);
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup();
  }
}

console.log(`✓ ${tests.length} JSearch provider tests passed`);
