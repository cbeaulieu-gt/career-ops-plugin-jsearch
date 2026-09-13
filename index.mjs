// @ts-check

import { normalizeUrl } from './lib/normalize-url.mjs';
import { fetchJsonWithRetry, isNetworkError } from './lib/http-retry.mjs';

const API_URL = 'https://jsearch.p.rapidapi.com/search-v2';
const API_HOST = 'jsearch.p.rapidapi.com';
// Controlled probes found JSearch returns at most 10 raw jobs per cursor page (#50).
const OBSERVED_PAGE_SIZE = 10;
const RETRY_POLICY = {
  isRetryable(error) {
    const status = error?.status;
    return status === 429 || (typeof status === 'number' && status >= 500)
      || (status === undefined && isNetworkError(error));
  },
};
const MAX_PAGE_BUDGET = 20;
const MAX_RESULT_BUDGET = 400;
const REQUIRED_FIELDS = [
  'job_id',
  'job_title',
  'employer_name',
  'job_publisher',
  'job_apply_link',
  'apply_options',
  'job_google_link',
  'job_location',
  'job_description',
  'job_is_remote',
  'job_posted_at_timestamp',
  'job_posted_at_datetime_utc',
];

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function listValue(value) {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return items.map(stringValue).filter(Boolean).join(',');
}

function projectedFields(value) {
  const configured = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set([...configured.map(stringValue).filter(Boolean), ...REQUIRED_FIELDS])].join(',');
}

function appendOptional(url, name, value) {
  const normalized = stringValue(value);
  if (normalized) url.searchParams.set(name, normalized);
}

function buildSearchUrl(entry, cursor, remoteOnly) {
  const url = new URL(API_URL);
  url.searchParams.set('query', stringValue(entry.query));
  url.searchParams.set('num_pages', '1');
  appendOptional(url, 'country', entry.country);
  appendOptional(url, 'language', entry.language);
  appendOptional(url, 'date_posted', entry.date_posted);
  const employmentTypes = listValue(entry.employment_types);
  if (employmentTypes) url.searchParams.set('employment_types', employmentTypes);
  const requirements = listValue(entry.job_requirements);
  if (requirements) url.searchParams.set('job_requirements', requirements);
  const radiusValue = entry.radius;
  const radiusProvided = radiusValue !== null
    && radiusValue !== undefined
    && (typeof radiusValue !== 'string' || radiusValue.trim() !== '');
  const radius = Number(radiusValue);
  if (radiusProvided && Number.isFinite(radius) && radius >= 0) {
    url.searchParams.set('radius', String(radius));
  }
  const excludedPublishers = listValue(entry.exclude_job_publishers);
  if (excludedPublishers) url.searchParams.set('exclude_job_publishers', excludedPublishers);
  if (entry.fields !== undefined) url.searchParams.set('fields', projectedFields(entry.fields));
  if (remoteOnly) url.searchParams.set('work_from_home', 'true');
  if (cursor) url.searchParams.set('cursor', cursor);
  return url;
}

function validHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function resultUrl(result) {
  const candidates = [
    result?.job_apply_link,
    ...(Array.isArray(result?.apply_options) ? result.apply_options.map((option) => option?.apply_link) : []),
    result?.job_google_link,
  ];
  return candidates.map(stringValue).find(validHttpUrl) || '';
}

function postedAt(result) {
  const seconds = Number(result?.job_posted_at_timestamp);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const parsed = Date.parse(result?.job_posted_at_datetime_utc);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeResult(result) {
  if (!result || typeof result !== 'object') return null;
  const id = stringValue(result.job_id);
  const title = stringValue(result.job_title);
  const url = resultUrl(result);
  if (!id || !title || !url) return null;

  const remote = result.job_is_remote === true;
  const baseLocation = stringValue(result.job_location);
  const locationParts = baseLocation ? [baseLocation] : [];
  if (remote && !/remote/i.test(baseLocation)) locationParts.push('Remote');
  const normalized = {
    id,
    title,
    url,
    company: stringValue(result.employer_name),
    location: locationParts.join(', '),
    description: stringValue(result.job_description),
    publisher: stringValue(result.job_publisher),
    remote,
  };
  const timestamp = postedAt(result);
  if (timestamp !== null) normalized.postedAt = timestamp;
  return normalized;
}

async function fetchPage(ctx, url, key) {
  try {
    return await fetchJsonWithRetry(ctx, url, {
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': API_HOST,
      },
    }, RETRY_POLICY);
  } catch (error) {
    let message = String(error?.message || error);
    for (const secret of [key, encodeURIComponent(key)]) {
      if (secret) message = message.split(secret).join('«redacted»');
    }
    const safeError = new Error(message);
    if (error?.status !== undefined) safeError.status = error.status;
    if (error?.retryAfter !== undefined) safeError.retryAfter = error.retryAfter;
    if (error?.attempts !== undefined) safeError.attempts = error.attempts;
    throw safeError;
  }
}

async function fetchPass(entry, ctx, key, pageBudget, resultBudget, remoteOnly, state) {
  let cursor = '';
  for (let page = 1; page <= pageBudget; page += 1) {
    const payload = await fetchPage(ctx, buildSearchUrl(entry, cursor, remoteOnly), key);
    if (
      !payload
      || typeof payload !== 'object'
      || payload.status !== 'OK'
      || !payload.data
      || !Array.isArray(payload.data.jobs)
    ) {
      throw new Error(`jsearch: malformed Search V2 response on page ${page}`);
    }
    for (const result of payload.data.jobs) {
      const normalized = normalizeResult(result);
      if (!normalized) continue;
      const urlKey = normalizeUrl(normalized.url);
      if (state.seenIds.has(normalized.id) || (urlKey && state.seenUrls.has(urlKey))) continue;
      state.seenIds.add(normalized.id);
      if (urlKey) state.seenUrls.add(urlKey);
      state.jobs.push(normalized);
      if (state.jobs.length >= resultBudget) return;
    }
    if (payload.data.jobs.length < OBSERVED_PAGE_SIZE) break;
    cursor = stringValue(payload.data.cursor);
    if (!cursor) break;
  }
}

export default {
  provider: {
    id: 'jsearch',
    detect() { return null; },

    fetch: async (entry, ctx) => {
      const key = ctx?.env?.JSEARCH_RAPIDAPI_KEY;
      if (!key) throw new Error('jsearch: JSEARCH_RAPIDAPI_KEY must be set in .env');
      if (typeof ctx?.fetchJson !== 'function') {
        throw new Error('jsearch: plugin context is missing fetchJson');
      }
      if (!stringValue(entry?.query)) {
        throw new Error(`jsearch: entry ${entry?.name || '(unnamed)'} requires a non-empty 'query'`);
      }
      const configuredPages = positiveInteger(entry?.max_pages, 1, MAX_PAGE_BUDGET);
      const pageBudget = positiveInteger(ctx?.maxPages, configuredPages, configuredPages);
      const resultBudget = positiveInteger(entry?.max_results, MAX_RESULT_BUDGET, MAX_RESULT_BUDGET);
      const state = { jobs: [], seenIds: new Set(), seenUrls: new Set() };
      if (entry?.include_geo !== false) {
        await fetchPass(entry, ctx, key, pageBudget, resultBudget, false, state);
      }
      if (entry?.include_remote === true && state.jobs.length < resultBudget) {
        await fetchPass(entry, ctx, key, pageBudget, resultBudget, true, state);
      }
      return state.jobs;
    },
  },
};
