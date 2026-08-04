/**
 * Verifies that every file manifest.json points at actually exists in dist/.
 *
 * Chrome reports a missing service worker or content script as a generic load
 * failure, which is a slow thing to debug by hand. This catches it in one second
 * at build time instead.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const manifestPath = join(dist, 'manifest.json');

if (!existsSync(manifestPath)) {
  console.error('✗ dist/manifest.json is missing — did the pages build run?');
  process.exit(1);
}

/** @type {Record<string, any>} */
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** Every dist-relative path the manifest points at. @type {string[]} */
const referenced = [];

/** @param {unknown} value */
const add = (value) => {
  if (typeof value === 'string' && value) referenced.push(value);
};

add(manifest.background?.service_worker);
add(manifest.side_panel?.default_path);
add(manifest.options_page);
for (const script of manifest.content_scripts ?? []) {
  for (const file of [...(script.js ?? []), ...(script.css ?? [])]) add(file);
}
for (const icon of Object.values(manifest.icons ?? {})) add(icon);
for (const icon of Object.values(manifest.action?.default_icon ?? {})) add(icon);
for (const resource of manifest.web_accessible_resources ?? []) {
  for (const file of resource.resources ?? []) add(file);
}

const missing = referenced.filter((file) => !existsSync(join(dist, file)));

if (missing.length > 0) {
  console.error(`✗ manifest references ${missing.length} missing file(s):`);
  for (const file of missing) console.error(`    dist/${file}`);
  process.exit(1);
}

console.log(`✓ manifest ok — ${referenced.length} referenced files present in dist/`);
