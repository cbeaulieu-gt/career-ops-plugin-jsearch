const TRACKING_PARAMS = [
  /^utm_/i, /^gh_src$/i, /^fbclid$/i, /^gclid$/i, /^mc_cid$/i,
  /^mc_eid$/i, /^igshid$/i, /^_hsenc$/i, /^_hsmi$/i, /^trk$/i,
  /^trackingid$/i,
];

function promoteKnownFragmentIdentity(url) {
  if (url.hostname.toLowerCase() !== 'app.mokahr.com') return;
  const match = /^#\/job\/([^/?#]+)(?:\?[^#]*)?$/.exec(url.hash);
  if (!match) return;
  let jobId;
  try {
    jobId = decodeURIComponent(match[1]);
  } catch {
    return;
  }
  if (jobId) url.searchParams.set('mokahr_job_id', jobId);
}

export function normalizeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return '';
  }
  if (!['http:', 'https:'].includes(url.protocol)) return '';

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase();
  promoteKnownFragmentIdentity(url);
  url.hash = '';

  const keep = [...url.searchParams].filter(([key]) => !TRACKING_PARAMS.some((pattern) => pattern.test(key)));
  keep.sort(([aKey, aValue], [bKey, bValue]) => (
    aKey !== bKey ? (aKey < bKey ? -1 : 1) : (aValue < bValue ? -1 : aValue > bValue ? 1 : 0)
  ));
  url.search = '';
  for (const [key, value] of keep) url.searchParams.append(key, value);

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}
