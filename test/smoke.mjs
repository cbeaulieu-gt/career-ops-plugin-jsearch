import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const validHooks = ['provider', 'ingest', 'search', 'notify', 'export'];
const manifest = JSON.parse(readFileSync(path.join(here, '..', 'manifest.json'), 'utf8'));
const entryUrl = pathToFileURL(path.join(here, '..', manifest.entry || 'index.mjs')).href;
const hooks = (await import(entryUrl)).default;

assert(hooks && typeof hooks === 'object');
assert.deepEqual(Object.keys(hooks), ['provider']);
assert(validHooks.includes('provider'));
assert.equal(hooks.provider.id, manifest.id);
console.log('✓ smoke ok: provider');
