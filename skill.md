---
name: career-ops-plugin-jsearch
description: Scan JSearch through its authenticated RapidAPI endpoint.
license: MIT
---

# JSearch plugin

This keyed provider searches the current JSearch `search-v2` endpoint through
RapidAPI. It runs only for a `portals.yml` entry with `provider: jsearch`; it is
never auto-detected. Install the standalone plugin with `plugins.mjs add`
before enabling it.

## Setup

1. Install this standalone plugin at a reviewed, pinned commit. See
   [README.md](README.md#install-and-enable) for the install-before-enable
   workflow.
2. Subscribe to [JSearch on RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch)
   and copy the application key into `.env` as `JSEARCH_RAPIDAPI_KEY`.
3. Run `node plugins.mjs enable jsearch --confirm` after previewing the
   capability card.
4. Add an explicit search entry to `portals.yml`:

```yaml
tracked_companies:
  - name: "JSearch — AI leadership in Canada"
    provider: jsearch
    query: "head of AI jobs in Toronto" # include the role and geo target
    country: ca                         # ISO 3166-1 alpha-2
    language: en                        # optional ISO 639 language code
    date_posted: week                   # all | today | 3days | week | month
    include_geo: true                   # default true; runs the base query
    include_remote: true                # default false; adds a remote-only pass
    employment_types: [FULLTIME, CONTRACTOR]
    job_requirements: [more_than_3_years_experience]
    radius: 50                          # optional distance in km
    exclude_job_publishers: [Dice]
    fields: [job_salary]                # required normalization fields are added
    max_pages: 3                        # 1–20 per enabled pass; default 1
    max_results: 50                     # 1–400 combined; default 400
    enabled: false
```

Set `enabled: true` when the query is ready. Results pass through the normal
scanner title, location, content, trust, deduplication, and pipeline-writing
stages. The plugin also deduplicates overlap between its geographic and remote
passes by JSearch job ID and canonical apply URL.
