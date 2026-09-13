# career-ops-plugin-jsearch

`career-ops-plugin-jsearch` is an unlisted standalone [Career-Ops](https://github.com/career-ops-hq/career-ops) provider plugin. It searches JSearch's `search-v2` endpoint through RapidAPI when a `portals.yml` entry explicitly sets `provider: jsearch`.

## Trust and provenance

This plugin is intentionally unlisted while it is reviewed and registered. A direct install is marked `❓ community-unverified`: Career-Ops has not approved that exact plugin commit in its registry, so you are trusting the author and the commit you choose. Review the source before installing, pin a full commit SHA, and review any later version before updating.

This extracted implementation originates from Career-Ops issue #45 and PR #47. It retains the original MIT license in [LICENSE](LICENSE).

## Install and enable

Run these commands from the root of a Career-Ops checkout. Installation and consent are separate steps: install first, inspect the capability card, then explicitly enable it.

```bash
# EXAMPLE ONLY — this is a placeholder SHA and cannot be used to install the plugin.
# Replace it with the exact 40-character commit SHA you reviewed.
node plugins.mjs add cbeaulieu-gt/career-ops-plugin-jsearch --sha 0123456789abcdef0123456789abcdef01234567

# Preview the capability card and trust boundary; this does not enable the plugin.
node plugins.mjs enable jsearch

# Enable only after reviewing the preview.
node plugins.mjs enable jsearch --confirm
```

The placeholder SHA above is deliberately not a usable release pin. Replace it with the exact 40-character commit SHA you reviewed; do not use a branch name, tag, or the placeholder value.

## Configure

Subscribe to [JSearch on RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch), then add the application key to the Career-Ops `.env` file:

```dotenv
JSEARCH_RAPIDAPI_KEY=your_rapidapi_application_key
```

The key is required. The provider reads it only from the plugin's scoped context, not from the process environment.

Add an explicit provider entry to `portals.yml`:

```yaml
tracked_companies:
  - name: "JSearch — AI leadership in Canada"
    provider: jsearch
    query: "head of AI jobs in Toronto"
    country: ca
    language: en
    date_posted: week
    include_geo: true
    include_remote: true
    employment_types: [FULLTIME, CONTRACTOR]
    job_requirements: [more_than_3_years_experience]
    radius: 50
    exclude_job_publishers: [Dice]
    fields: [job_salary]
    max_pages: 3
    max_results: 50
    enabled: false
```

`query` is required. The remaining supported portal fields are:

| Field | Meaning |
| --- | --- |
| `name` | A human-readable label for the search entry. |
| `provider` | Must be `jsearch`; the plugin is never auto-detected. |
| `query` | Required JSearch search query; include the role and location target. |
| `country` | Optional ISO 3166-1 alpha-2 country code. |
| `language` | Optional ISO 639 language code. |
| `date_posted` | Optional recency filter: `all`, `today`, `3days`, `week`, or `month`. |
| `include_geo` | Runs the base geographic/query pass; defaults to `true`. |
| `include_remote` | Adds a `work_from_home=true` pass; defaults to `false`. |
| `employment_types` | Optional list or comma-separated JSearch employment types, such as `FULLTIME` or `CONTRACTOR`. |
| `job_requirements` | Optional list or comma-separated requirements, such as `more_than_3_years_experience` or `no_degree`. |
| `radius` | Optional non-negative distance in kilometres. |
| `exclude_job_publishers` | Optional list or comma-separated publishers to exclude. |
| `fields` | Optional list or comma-separated extra response fields. Required normalization fields are always requested. |
| `max_pages` | Maximum cursor pages per enabled pass: 1–20; defaults to 1 and is capped at 20. |
| `max_results` | Maximum unique results across enabled passes: 1–400; defaults to 400 and is capped at 400. |
| `enabled` | Set to `true` only when you are ready for Career-Ops to run this search. |

Set `enabled: true` after reviewing the query. Geographic and remote passes are deduplicated by JSearch job ID and canonical application URL before results reach the normal scanner pipeline.

## Security and review boundary

The manifest declares one scoped credential, `JSEARCH_RAPIDAPI_KEY`, and permits network egress only to `jsearch.p.rapidapi.com`. Requests use Career-Ops' guarded plugin transport, so the manifest host allowlist and its SSRF protections remain in force. The provider makes no filesystem, tracker, or application writes; it returns normalized jobs to Career-Ops.

The provider bounds work to 20 cursor pages per enabled pass and 400 unique combined results. It retries transient network errors, rate limits, and server errors with bounded delays; it redacts the RapidAPI key from surfaced errors. It accepts only HTTP(S) application URLs and drops unusable records.

This plugin never submits applications. Career-Ops is human-in-the-loop: review the installed commit, the capability card, configured query, scan results, and any application before acting.

## Test

Node.js 18 or later is required. From this plugin directory, run:

```bash
npm test
```

## License

MIT. See [LICENSE](LICENSE).
