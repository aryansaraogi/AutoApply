/**
 * Launches the built extension in Chrome and drives a real fill.
 *
 * Chrome extensions cannot be exercised from a test runner — the content script
 * needs a live `chrome.runtime`, and the service worker is where storage and
 * messaging actually live. So this speaks CDP to the extension's own service
 * worker and asks it to do exactly what the side panel does: seed a profile,
 * inject the content script, and send FILL_PAGE.
 *
 * Usage:
 *   node scripts/drive.mjs              automated: fill, assert, screenshot, quit
 *   node scripts/drive.mjs --keep-open  set up and hand the browser to a human
 *   node scripts/drive.mjs --store      same drive, captured at 1280×800 for the
 *                                       Chrome Web Store listing
 *
 * --keep-open does the tedious part (profile, résumé, site permission, content
 * script injected) and then leaves Chrome running so you can click Fill yourself
 * and watch it happen. It performs no fill of its own — the point is that what
 * you see is your own click.
 */

import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Which build to load. Defaults to dist/, but set AUTOAPPLY_EXT_DIR to point at
 * an unpacked release so the drive verifies the artifact that actually ships
 * rather than the one the build happened to leave behind.
 */
const dist = process.env.AUTOAPPLY_EXT_DIR
  ? resolve(process.env.AUTOAPPLY_EXT_DIR)
  : join(root, 'dist');
const PORT = 9222;
const FIXTURE = 'http://localhost:4321/sample-application.html';

/** Hand the browser over instead of driving and quitting. */
const KEEP_OPEN = process.argv.includes('--keep-open');

/**
 * Capture listing screenshots instead of debug ones. The store requires exactly
 * 1280×800 (or 640×400), so the window is sized to match and the images land in
 * store/ under the names STORE-LISTING.md refers to.
 */
const STORE = process.argv.includes('--store');
const SHOT_WIDTH = STORE ? 1280 : 1024;
const SHOT_HEIGHT = STORE ? 800 : 700;

/**
 * Where a screenshot goes, given its debug name and its listing name.
 * @param {string} debugName
 * @param {string} storeName
 */
function shotPath(debugName, storeName) {
  return STORE ? join(root, 'store', storeName) : join(root, debugName);
}

/**
 * Chrome for Testing, not the installed browser.
 *
 * Chrome 137+ removed `--load-extension` from regular builds for security — it
 * is silently ignored, and you end up attached to a Chrome component extension
 * wondering why `chrome.storage` is undefined. The Chrome for Testing build
 * still honours it, which is exactly what it exists for.
 *
 *   npx @puppeteer/browsers install chrome@stable
 */
function findChromeForTesting() {
  const base = join(root, 'chrome');
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    const exe = join(base, dir, 'chrome-win64', 'chrome.exe');
    if (existsSync(exe)) return exe;
    const nix = join(base, dir, 'chrome-linux64', 'chrome');
    if (existsSync(nix)) return nix;
    const mac = join(base, dir, 'chrome-mac-x64', 'Google Chrome for Testing.app',
      'Contents', 'MacOS', 'Google Chrome for Testing');
    if (existsSync(mac)) return mac;
  }
  return null;
}

/** The profile the drive fills with. Mirrors tests/fixture.test.ts. */
const PROFILE = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '+1 555 010 1842',
  city: 'London',
  country: 'United Kingdom',
  linkedin: 'https://linkedin.com/in/ada',
  github: 'https://github.com/ada',
  portfolio: 'https://ada.dev',
  currentCompany: 'Analytical Engines Ltd',
  currentTitle: 'Principal Engineer',
  yearsExperience: '12',
  desiredSalary: '$185,000',
  earliestStartDate: '2026-09-01',
  workAuthorized: 'Yes',
  requiresSponsorship: 'No',
  gender: 'Female',
  veteranStatus: 'I am not a protected veteran',
  disabilityStatus: 'No, I do not have a disability and have not had one in the past',
  pronouns: 'she/her',
  howHeard: 'LinkedIn',
  coverLetter: 'I have spent twelve years building platform tooling.',
};

/**
 * A stand-in résumé. Only the first bytes need to look like a PDF — nothing
 * parses it; the point is proving a real File reaches the form's file input.
 */
const RESUME_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);
const RESUME_BASE64 = RESUME_BYTES.toString('base64');
const RESUME_META = {
  id: 'drive-resume',
  label: 'General résumé',
  filename: 'ada-lovelace.pdf',
  mimeType: 'application/pdf',
  sizeBytes: RESUME_BYTES.length,
  addedAt: Date.now(),
  isDefault: true,
};

// ── tiny CDP client ─────────────────────────────────────────────────────────

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

  /**
   * Evaluates an async expression and returns its resolved value.
   * @param {string} expression
   * @param {boolean} [userGesture]
   */
  async evaluate(expression, userGesture = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** @param {number} ms */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/**
 * Screenshots a page at exactly the target size.
 *
 * The store rejects anything that is not 1280×800 or 640×400, and a browser
 * window is never exactly its viewport — so the size is forced through CDP
 * rather than hoped for from --window-size.
 * @param {Cdp} cdp
 */
async function capture(cdp) {
  // Chrome returns an empty frame for a backgrounded renderer, so a tab that is
  // not on screen screenshots as plain white at the correct dimensions — which
  // looks like a working capture until you open the file. Focus it first.
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.bringToFront');

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: SHOT_WIDTH,
    height: SHOT_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(400);

  // No clip and no captureBeyondViewport: the metrics override above already
  // makes the viewport exactly SHOT_WIDTH×SHOT_HEIGHT, and both of those options
  // break this shot. A clip without captureBeyondViewport returns white for
  // anything outside the real viewport; captureBeyondViewport re-renders the
  // page outside its viewport, which drops position:fixed elements — and the
  // review overlay, the one thing worth showing, is position:fixed.
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
  return shot;
}

/**
 * @param {() => Promise<any>} probe
 * @param {string} what
 * @param {number} [timeoutMs]
 */
async function waitFor(probe, what, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no result';
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what} (${lastError})`);
}

/** @returns {Promise<any[]>} */
async function targets() {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return /** @type {any[]} */ (await response.json());
}

// ── drive ───────────────────────────────────────────────────────────────────

async function main() {
  if (!existsSync(join(dist, 'manifest.json'))) {
    throw new Error('dist/ is not built — run `npm run build` first.');
  }

  const chrome = findChromeForTesting();
  if (!chrome) {
    throw new Error(
      'Chrome for Testing not found. Install it with:\n' +
        '  npx @puppeteer/browsers install chrome@stable\n' +
        '(The regular Chrome build ignores --load-extension since v137.)',
    );
  }

  if (STORE) mkdirSync(join(root, 'store'), { recursive: true });

  const userDataDir = await mkdtemp(join(tmpdir(), 'autoapply-'));
  console.log(`▶ launching Chrome\n  extension: ${dist}\n  profile:   ${userDataDir}`);

  const child = spawn(
    chrome,
    [
      `--load-extension=${dist}`,
      `--disable-extensions-except=${dist}`,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=DialMediaRouteProvider',
      // Deliberately no --window-size: capture() forces exact device metrics
      // through CDP, and sizing the window as well stalled the permission
      // prompt that chrome.permissions.request raises.
      FIXTURE,
    ],
    // Detached in keep-open mode so the browser outlives this script.
    { detached: KEEP_OPEN, stdio: 'ignore' },
  );
  if (KEEP_OPEN) child.unref();

  try {
    await waitFor(() => fetch(`http://127.0.0.1:${PORT}/json/version`), 'Chrome debug port');

    // Chrome ships its own component extensions (Media Router, Gemini), each with
    // a service worker of its own, so "the first service_worker target" is not
    // ours. Ours is the one serving the service worker file the manifest names.
    const worker = await waitFor(async () => {
      const list = await targets();
      return list.find(
        (t) =>
          t.type === 'service_worker' && String(t.url).endsWith('/service-worker.js'),
      );
    }, 'the AutoApply service worker');

    const extensionId = new URL(worker.url).host;
    console.log(`✓ extension loaded — id ${extensionId}`);

    // Drive through the extension's own options page rather than the service
    // worker. A worker attached to at browser start is paused pre-initialisation
    // — it still has the generic binding set, without the permission-gated APIs
    // (storage, scripting) this drive needs. An extension page is a fully
    // initialised context with the same privileges, and it is a plain CDP page
    // target, so it is both more capable and simpler to talk to.
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;

    // The service worker's onInstalled handler already opens this on first run,
    // so usually it is here waiting. Open it ourselves only if it is not.
    const findOptions = async () => {
      const list = await targets();
      return list.find((t) => t.type === 'page' && String(t.url).startsWith(optionsUrl));
    };

    if (!(await findOptions())) {
      await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(optionsUrl)}`, {
        method: 'PUT',
      });
    }
    const optionsTarget = await waitFor(findOptions, 'extension options page');

    const sw = new Cdp(optionsTarget.webSocketDebuggerUrl);
    await sw.ready();
    await sw.send('Runtime.enable');

    await waitFor(
      () => sw.evaluate(`typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.scripting`),
      'extension APIs on the options page',
    );
    console.log('✓ extension context ready (options page)');

    // 1. Seed a profile and a résumé, the way the options page would.
    await sw.evaluate(`chrome.storage.local.set({ profile: ${JSON.stringify(PROFILE)} })`);
    console.log('✓ profile seeded');

    // Only the automated run seeds a résumé. In keep-open mode a stub would
    // claim the default slot, so a real résumé the user then adds would sit
    // second and never be the one attached — the test data would quietly
    // sabotage the thing being verified.
    if (!KEEP_OPEN) {
      await sw.evaluate(`chrome.storage.local.set({
        resumes: ${JSON.stringify([RESUME_META])},
        ${JSON.stringify('resume:' + RESUME_META.id)}: ${JSON.stringify(RESUME_BASE64)}
      })`);
      console.log(`✓ résumé seeded — ${RESUME_META.filename}`);
    }

    // 2. Grant the fixture origin. This is the "Enable AutoApply on this site"
    //    button; the permission API needs a user gesture, which CDP can supply.
    const granted = await sw.evaluate(
      `chrome.permissions.request({ origins: ['http://localhost:4321/*'] })`,
      true,
    );
    if (!granted) throw new Error('permission for the fixture origin was refused');
    console.log('✓ localhost permission granted');

    // 2b. Reload the options page so it renders the seeded résumé, and capture
    //     it — a broken résumé manager is a layout problem no test would see.
    //
    //     Automated runs only: keep-open seeds no résumé, so there would be no
    //     list item to wait for, and the user is about to look at the real page
    //     anyway.
    if (!KEEP_OPEN) {
      await sw.send('Page.enable').catch(() => {});
      await sw.evaluate('location.reload()');
      await waitFor(
        () => sw.evaluate(`document.querySelectorAll('#resume-list .resume-item').length`),
        'the résumé list to render',
      );
      // Debug runs frame the résumé manager, which is the part most likely to
      // break. The listing shot instead opens on the profile itself — filled-in
      // fields say "this is where the answers come from" far better than a view
      // dominated by an empty textarea and a Reset button.
      await sw.evaluate(
        STORE
          ? `window.scrollTo({ top: 0 })`
          : `document.getElementById('resume-section').scrollIntoView({ block: 'start' })`,
      );
      const optionsShot = await capture(sw);
      const optionsPath = shotPath('drive-options.png', 'screenshot-3-profile.png');
      await writeFile(optionsPath, Buffer.from(optionsShot.data, 'base64'));
      console.log(`✓ options screenshot → ${relative(root, optionsPath)}`);
    }

    if (KEEP_OPEN) {
      await handOver(sw, extensionId);
      return;
    }

    // 3. Inject and drive, exactly as the side panel does.
    const report = await sw.evaluate(`(async () => {
      const [tab] = await chrome.tabs.query({ url: 'http://localhost:4321/*' });
      if (!tab) throw new Error('fixture tab not found');
      // Foreground the form, as it would be when a user clicks Fill.
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['content.js'],
      });
      const described = await chrome.tabs.sendMessage(tab.id, { type: 'DESCRIBE_PAGE' });
      const filled = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_PAGE' });
      const history = (await chrome.storage.local.get('applications')).applications ?? [];
      return { described, filled, history };
    })()`);

    console.log('\n▶ DESCRIBE_PAGE');
    console.log(`  adapter ${report.described.adapter} · ${report.described.fieldCount} fields`);
    console.log(`  ${report.described.role} @ ${report.described.company}`);

    console.log('\n▶ FILL_PAGE');
    console.log(
      `  filled ${report.filled.filled} · skipped ${report.filled.skipped} · ` +
        `${report.filled.requiredUnfilled} required left`,
    );

    console.log('\n▶ history');
    for (const entry of report.history) {
      console.log(`  [${entry.stage}] ${entry.role} — ${entry.company} (${entry.fieldsFilled})`);
    }

    // 4. Read the page back to confirm the values really landed in the DOM.
    const page = await waitFor(async () => {
      const list = await targets();
      return list.find((t) => t.type === 'page' && String(t.url).includes('sample-application'));
    }, 'fixture page target');

    const tab = new Cdp(page.webSocketDebuggerUrl);
    await tab.ready();
    await tab.send('Runtime.enable');

    const values = await tab.evaluate(`(() => {
      const v = (sel) => document.querySelector(sel)?.value ?? '(missing)';
      const checked = (sel) => !!document.querySelector(sel)?.checked;
      return {
        firstName: v('#first_name'),
        lastName: v('#last_name'),
        email: v('#contact'),
        phone: v('[name="phone"]'),
        country: v('[name="country"]'),
        linkedin: v('#li'),
        currentCompany: v('#co'),
        salary: v('#sal'),
        startDate: v('#start'),
        veteran: v('#vet'),
        pronounsInShadow:
          document.getElementById('shadow-host')?.shadowRoot?.getElementById('pronouns')?.value,
        authorizedYes: checked('[name="work_auth"][value="Yes"]'),
        sponsorshipNo: checked('[name="sponsorship"][value="No"]'),
        DECOY_previousEmployer: v('#prev'),
        DECOY_companyWebsite: v('#site'),
        DECOY_password: v('#pw'),
        DECOY_consentTicked: checked('[name="consent"]'),
        DECOY_whyUsEssay: v('#why'),
        RESUME_attachedName: document.querySelector('#resume')?.files?.[0]?.name ?? '(none)',
        RESUME_attachedBytes: document.querySelector('#resume')?.files?.[0]?.size ?? 0,
        overlayPresent: !!document.getElementById('autoapply-review-root'),
      };
    })()`);

    console.log('\n▶ page state after fill');
    for (const [key, value] of Object.entries(values)) {
      const mark = key.startsWith('DECOY_') ? '·' : '✓';
      console.log(`  ${mark} ${key.padEnd(24)} ${JSON.stringify(value)}`);
    }

    // 5. The tracker page, driven the way the side panel opens it.
    const trackerUrl = `chrome-extension://${extensionId}/tracker.html`;
    await sw.evaluate(`chrome.tabs.create({ url: ${JSON.stringify(trackerUrl)} })`);

    const trackerTarget = await waitFor(async () => {
      const list = await targets();
      return list.find((t) => t.type === 'page' && String(t.url).startsWith(trackerUrl));
    }, 'tracker page');

    const tracker = new Cdp(trackerTarget.webSocketDebuggerUrl);
    await tracker.ready();
    await tracker.send('Runtime.enable');

    const trackerState = await waitFor(
      () =>
        tracker.evaluate(`(() => {
          const rows = document.querySelectorAll('#rows tr');
          if (rows.length === 0) return null;
          const first = rows[0];
          return {
            rows: rows.length,
            role: first.querySelector('.role-link')?.textContent,
            company: first.querySelector('.col-company')?.textContent,
            stage: first.querySelector('.col-stage select')?.value,
            stageOptions: [...first.querySelectorAll('.col-stage option')].map(o => o.value),
            summary: document.getElementById('summary')?.textContent,
          };
        })()`),
      'tracker rows',
    );

    console.log('\n▶ tracker page');
    console.log(`  ${trackerState.summary}`);
    console.log(`  row 1: ${trackerState.role} @ ${trackerState.company} — stage "${trackerState.stage}"`);
    console.log(`  stages available: ${trackerState.stageOptions.join(', ')}`);

    // Change the stage the way a user would, and confirm it persists.
    await tracker.evaluate(`(() => {
      const select = document.querySelector('#rows tr .col-stage select');
      select.value = 'interview';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const persisted = await waitFor(
      () =>
        sw.evaluate(
          `chrome.storage.local.get('applications').then(r => r.applications?.[0]?.stage ?? '')`,
        ),
      'the stage change to persist',
    );
    console.log(`  set stage to Interview → stored as "${persisted}"`);

    const trackerShot = await capture(tracker);
    const trackerPath = shotPath('drive-tracker.png', 'screenshot-2-tracker.png');
    await writeFile(trackerPath, Buffer.from(trackerShot.data, 'base64'));
    console.log(`✓ tracker screenshot → ${relative(root, trackerPath)}`);
    tracker.close();

    // Frame the shot on the part of the form that shows the work: filled fields
    // with their green outlines, and the two eligibility questions answered
    // independently. The review overlay is fixed, so it stays in frame.
    await tab.evaluate(
      `document.querySelector('fieldset:nth-of-type(3)')?.scrollIntoView({ block: 'start' })`,
    );

    const shot = await capture(tab);
    const formPath = shotPath('drive-screenshot.png', 'screenshot-1-fill.png');
    await writeFile(formPath, Buffer.from(shot.data, 'base64'));
    console.log(`\n✓ screenshot → ${relative(root, formPath)}`);

    sw.close();
    tab.close();
  } finally {
    if (!KEEP_OPEN) child.kill();
  }
}

/**
 * Prepares the browser for a human and steps back.
 *
 * Everything tedious is done — profile, résumé, site permission, content script
 * injected — but no field is filled, so whatever appears afterwards is the
 * result of the user's own click.
 *
 * @param {Cdp} sw
 * @param {string} extensionId
 */
async function handOver(sw, extensionId) {
  const injected = await sw.evaluate(`(async () => {
    const [tab] = await chrome.tabs.query({ url: 'http://localhost:4321/*' });
    if (!tab) throw new Error('fixture tab not found');
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    });
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
      return { tabId: tab.id, panel: true };
    } catch {
      // The toolbar icon still works; a fresh profile just does not pin it.
      return { tabId: tab.id, panel: false };
    }
  })()`,
    // sidePanel.open() requires a user gesture. Without this flag it rejects
    // and the panel silently never appears — which reads as "the extension
    // isn't working" rather than "the panel wasn't opened".
    true,
  );

  console.log('✓ content script injected into the fixture tab');
  console.log(
    injected.panel
      ? '✓ side panel opened'
      : '· side panel could not be opened automatically — use the toolbar icon',
  );

  console.log(`
────────────────────────────────────────────────────────────────────
  The browser is yours. Nothing has been filled yet.

  1. If the side panel is not showing, click the puzzle-piece icon in
     the toolbar, then AutoApply. (A fresh profile does not pin it.)
  2. Press "Fill this page" and watch the form.
  3. Green outline = filled from your profile. Amber = still needs you.
  4. Check the decoys stayed empty: Previous Employer, Company website,
     Create a password, and the "Why do you want to work here?" essay.
     The consent box must be unticked and the résumé must be attached.
  5. "Open tracker" in the panel → change the stage, add a note.
  6. "Profile" → scroll to Résumés to add or swap a file.

  Seeded for you: Ada Lovelace's profile + a stub ada-lovelace.pdf,
  and permission for localhost:4321.

  Extension id: ${extensionId}
  Close the browser window when you are done.
────────────────────────────────────────────────────────────────────`);
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
