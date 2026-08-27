/**
 * Renders the extension icon at every size the manifest asks for.
 *
 * Uses the Chrome for Testing binary already downloaded for `npm run drive`, so
 * there is no image-processing dependency to install and the mark is defined in
 * CSS rather than committed as opaque binary blobs.
 *
 * The mark: an indigo rounded square with two white bars, one full width and one
 * short — a form being filled in. Deliberately not a checkmark or a paper plane;
 * this extension never submits anything, and a tick would say it does. Two bars
 * is about the most detail that still reads at 16px.
 *
 * Usage: node scripts/make-icons.mjs
 */

import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
const PORT = 9333;
const SIZES = [16, 32, 48, 128];

/** Indigo, matching --accent in src/ui/shared.css. */
const ACCENT = '#4f46e5';

/**
 * One icon at a given pixel size. Everything scales off the box so the mark has
 * the same proportions at 16 as at 128 — bar weight and corner radius included,
 * which is what stops the small sizes turning to mud.
 */
/** @param {number} size */
function markup(size) {
  const radius = Math.round(size * 0.22);
  const padX = Math.round(size * 0.22);
  const barH = Math.max(2, Math.round(size * 0.1));
  const gap = Math.max(2, Math.round(size * 0.13));
  const barR = barH / 2;

  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .icon {
    width: ${size}px;
    height: ${size}px;
    border-radius: ${radius}px;
    background: ${ACCENT};
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: center;
    gap: ${gap}px;
    padding: 0 ${padX}px;
    box-sizing: border-box;
  }
  .bar {
    height: ${barH}px;
    border-radius: ${barR}px;
    background: #ffffff;
  }
  .bar.full { width: 100%; }
  .bar.short { width: 55%; opacity: 0.72; }
</style>
<div class="icon"><div class="bar full"></div><div class="bar short"></div></div>`;
}

class Cdp {
  /** @param {string} url */
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    /** @type {Map<number, {resolve: (v: any) => void, reject: (e: Error) => void}>} */
    this.pending = new Map();
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }

  ready() {
    return new Promise((res, rej) => {
      this.socket.addEventListener('open', () => res(undefined), { once: true });
      this.socket.addEventListener('error', () => rej(new Error('CDP socket failed')), {
        once: true,
      });
    });
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<any>}
   */
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

function findChromeForTesting() {
  const base = join(root, 'chrome');
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    for (const rel of [
      ['chrome-win64', 'chrome.exe'],
      ['chrome-linux64', 'chrome'],
      ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ]) {
      const exe = join(base, dir, ...rel);
      if (existsSync(exe)) return exe;
    }
  }
  return null;
}

/** @param {number} ms */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function main() {
  const chrome = findChromeForTesting();
  if (!chrome) {
    throw new Error(
      'Chrome for Testing not found. Install it with:\n  npm run drive:setup',
    );
  }

  mkdirSync(outDir, { recursive: true });

  const userDataDir = await mkdtemp(join(tmpdir(), 'autoapply-icons-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--hide-scrollbars',
      // Transparent corners outside the rounded square, rather than white ones.
      '--default-background-color=00000000',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  try {
    let version = null;
    for (let attempt = 0; attempt < 60 && !version; attempt++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      } catch {
        await sleep(250);
      }
    }
    if (!version) throw new Error('Chrome did not open its debug port');

    const targets = /** @type {any[]} */ (
      await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
    );
    const page = targets.find((/** @type {any} */ t) => t.type === 'page');
    if (!page) throw new Error('no page target');

    const cdp = new Cdp(page.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send('Page.enable');

    for (const size of SIZES) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size,
        height: size,
        deviceScaleFactor: 1,
        mobile: false,
      });

      // Asked for explicitly rather than relying on --default-background-color,
      // which current Chrome builds ignore at capture time — leaving the corners
      // outside the rounded square opaque white instead of transparent, which
      // shows as a white tile behind the mark on a dark toolbar.
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });

      const html = markup(size).replace(/`/g, '\\`');
      await cdp.send('Runtime.evaluate', {
        expression: `document.open(); document.write(\`${html}\`); document.close();`,
      });
      await sleep(120);

      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
      });

      const file = join(outDir, `icon-${size}.png`);
      await writeFile(file, Buffer.from(shot.data, 'base64'));
      console.log(`✓ ${size}×${size} → public/icons/icon-${size}.png`);
    }
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
