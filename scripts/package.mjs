/**
 * Builds the Chrome Web Store upload.
 *
 * Expects `npm run build:release` to have run first — that is the build that
 * drops sourcemaps. This script only zips, and it refuses to package anything
 * that should not be uploaded rather than trusting the build to be clean.
 *
 * The zip is written by hand against Node's built-in zlib so packaging needs no
 * dependency at all. That matters more than it sounds: the alternative is
 * pulling an archiver into a project whose entire pitch is that it ships no
 * third-party code.
 *
 * Usage: node scripts/package.mjs
 */

import { readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { deflateRawSync, crc32 } from 'node:zlib';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const releases = join(root, 'releases');

/** Anything matching these must never reach the store. */
const FORBIDDEN = [/\.map$/i, /\.ts$/i, /^node_modules[\\/]/i, /^src[\\/]/i];

/** Files the manifest cannot work without. */
const REQUIRED = [
  'manifest.json',
  'service-worker.js',
  'content.js',
  'options.html',
  'sidepanel.html',
  'tracker.html',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
];

/** @param {string} dir @returns {string[]} paths relative to dist, POSIX-separated */
function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full));
    else found.push(relative(dist, full).split(sep).join('/'));
  }
  return found;
}

/**
 * MS-DOS packed time and date, which is what the zip format stores.
 * @param {Date} date
 */
function dosStamp(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Minimal ZIP writer: one deflated entry per file, then the central directory.
 * @param {{ name: string, data: Buffer }[]} entries
 */
function buildZip(entries) {
  const { time, day } = dosStamp(new Date());
  /** @type {Buffer[]} */
  const chunks = [];
  /** @type {Buffer[]} */
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const sum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(sum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);

    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const directoryBuffer = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, directoryBuffer, end]);
}

async function main() {
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));

  if (manifest.version !== version) {
    throw new Error(
      `version mismatch: package.json says ${version}, manifest says ${manifest.version}`,
    );
  }

  const names = walk(dist).sort();

  const banned = names.filter((name) => FORBIDDEN.some((pattern) => pattern.test(name)));
  if (banned.length > 0) {
    throw new Error(
      `these must not ship — run \`npm run build:release\`, not \`npm run build\`:\n  ` +
        banned.join('\n  '),
    );
  }

  const missing = REQUIRED.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    throw new Error(`dist/ is missing required files:\n  ${missing.join('\n  ')}`);
  }

  const entries = names.map((name) => ({
    name,
    data: readFileSync(join(dist, name.split('/').join(sep))),
  }));

  mkdirSync(releases, { recursive: true });
  const target = join(releases, `autoapply-${version}.zip`);
  const zip = buildZip(entries);
  await writeFile(target, zip);

  const raw = entries.reduce((total, entry) => total + entry.data.length, 0);
  console.log(`✓ ${entries.length} files, ${(raw / 1024).toFixed(0)} KB → ${(zip.length / 1024).toFixed(0)} KB`);
  console.log(`✓ ${relative(root, target)}`);
  console.log(`\nUpload this at https://chrome.google.com/webstore/devconsole`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
