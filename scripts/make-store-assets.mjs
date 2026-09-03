/**
 * Renders every image the Chrome Web Store listing needs.
 *
 * Same approach as make-icons.mjs: the artwork is defined here in CSS and
 * rendered by the Chrome for Testing binary already downloaded for `npm run
 * drive`, so there is no design tool in the loop and no binary blob whose source
 * has been lost. Change a headline here, re-run, and every asset is regenerated
 * at exactly the dimensions the store validates against.
 *
 * Sizes are fixed by the store and are not negotiable:
 *
 *   store icon      128×128   96×96 of artwork inside 16px of transparent
 *                             padding — this is NOT the same as the manifest
 *                             icon, which is full-bleed 128
 *   screenshots     1280×800  1 to 5 of them, square corners, full bleed
 *   small promo     440×280   required to rank alongside extensions that have one
 *   marquee promo   1400×560  optional, but the only way to be featured
 *
 * Everything renders headless, so unlike `npm run screenshots` this needs no
 * window focus and no permission prompt.
 *
 * Every employer and web address in these mockups is invented, and the domains
 * use the RFC-reserved .example TLD. Two submissions were rejected for keyword
 * spam over lists of real brand names, and the policy covers screenshots and
 * promotional images as well as the description — a column of real company
 * names in the tracker shot is that same shape. Invented names demonstrate the
 * product just as well and cannot be read as a brand list. Keep it that way.
 *
 * Usage: node scripts/make-store-assets.mjs
 */

import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'store');
const PORT = 9334;

// ── palette ─────────────────────────────────────────────────────────────────

/**
 * Marketing palette. The indigo is the extension's own accent; the amber is its
 * complement and is used only on the one word per headline that carries the
 * idea. Deep and pale variants alternate slide to slide so the five screenshots
 * read as a set rather than five of the same picture.
 */
const C = {
  indigo: '#4f46e5',
  indigoDeep: '#3730a3',
  amber: '#fbbf24',
  ink: '#0f1116',
  paper: '#ffffff',
};

/** The dot grid both background treatments carry, at the given dot colour.
 *  @param {string} colour */
const dots = (colour) =>
  `radial-gradient(${colour} 1px, transparent 1px) 0 0 / 22px 22px`;

const DEEP_BG = `
  background:
    ${dots('rgba(255,255,255,.055)')},
    radial-gradient(900px 500px at 78% 12%, rgba(129,140,248,.28), transparent 60%),
    linear-gradient(135deg, #3b2f9e 0%, #262062 42%, #14133a 100%);
`;

const PALE_BG = `
  background:
    ${dots('rgba(79,70,229,.10)')},
    radial-gradient(760px 460px at 18% 10%, rgba(199,210,254,.55), transparent 62%),
    linear-gradient(135deg, #f7f6ff 0%, #eef0fe 48%, #e2e6fb 100%);
`;

// ── shared css ──────────────────────────────────────────────────────────────

/**
 * Georgia rather than a downloaded face: these render on whatever machine runs
 * the script, and a missing web font would silently fall back to something
 * else in the exported PNG with nothing to catch it.
 */
const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow: hidden;
  }
  .stage { position: relative; width: 100%; height: 100%; overflow: hidden; }

  .eyebrow {
    font-size: 13px; font-weight: 700; letter-spacing: .19em;
    text-transform: uppercase;
  }
  .display {
    font-family: Georgia, 'Times New Roman', serif;
    font-weight: 400; line-height: 1.03; letter-spacing: -.02em;
  }
  .display em { font-style: italic; }
  .lede { line-height: 1.55; }

  /* Deep slides */
  .deep .eyebrow { color: ${C.amber}; }
  .deep .display { color: #fff; }
  .deep .display em { color: ${C.amber}; }
  .deep .lede { color: rgba(255,255,255,.74); }

  /* Pale slides */
  .pale .eyebrow { color: ${C.indigo}; }
  .pale .display { color: #14133a; }
  .pale .display em { color: ${C.indigo}; }
  .pale .lede { color: #4b5168; }

  /* ── browser mockup ── */
  .win {
    background: #fff; border-radius: 14px; overflow: hidden;
    box-shadow: 0 50px 90px -30px rgba(10,8,40,.62), 0 12px 28px rgba(10,8,40,.30);
  }
  .win.dark { background: #14161d; }
  .bar {
    height: 40px; background: #eceef4; display: flex; align-items: center;
    gap: 7px; padding: 0 14px; border-bottom: 1px solid #dfe2ea;
  }
  .win.dark .bar { background: #1c2029; border-bottom-color: #2a2f3b; }
  .dot { width: 11px; height: 11px; border-radius: 99px; }
  .url {
    flex: 1; margin-left: 8px; height: 24px; border-radius: 99px;
    background: #fff; border: 1px solid #dfe2ea;
    display: flex; align-items: center; justify-content: center;
    font-size: 11.5px; color: #6b7280;
  }
  .win.dark .url { background: #0f1116; border-color: #2a2f3b; color: #98a1b2; }

  /* ── form field ── */
  .field { margin-bottom: 13px; }
  .flabel { font-size: 11.5px; font-weight: 600; color: #5b6373; margin-bottom: 5px; }
  .fbox {
    height: 34px; border: 1px solid #cfd3de; border-radius: 6px; background: #fff;
    display: flex; align-items: center; padding: 0 10px; font-size: 13px; color: #14161d;
  }
  .fbox.filled { border: 2px solid #16a34a; outline: 2px solid rgba(22,163,74,.16); }
  .fbox.empty { color: #a6acba; }
  .fbox.flag { border: 2px solid #d97706; outline: 2px solid rgba(217,119,6,.16); }

  /* ── review overlay ── */
  .panel {
    width: 320px; background: #fff; border-radius: 12px; overflow: hidden;
    border: 1px solid rgba(18,22,32,.10);
    box-shadow: 0 30px 60px -18px rgba(10,8,40,.45);
  }
  .panel-h { padding: 13px 14px 11px; border-bottom: 1px solid rgba(18,22,32,.09); }
  .panel-t { font-size: 14px; font-weight: 700; color: #14161d; letter-spacing: -.01em; }
  .chips { display: flex; gap: 5px; margin-top: 9px; flex-wrap: wrap; }
  .chip { padding: 3px 9px; border-radius: 99px; font-size: 11px; font-weight: 700; }
  .chip.ok { background: #e6f5ec; color: #16794a; }
  .chip.mut { background: #f1f2f6; color: #5b6373; }
  .chip.warn { background: #fdf2df; color: #8a5a00; }
  .panel-b { padding: 11px 14px 14px; }
  .sec {
    font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
    color: #5b6373; margin-bottom: 8px;
  }
  .item {
    border: 1px solid rgba(18,22,32,.10); border-radius: 8px;
    padding: 8px 10px; margin-bottom: 6px;
  }
  .item.req { border-left: 3px solid #d97706; }
  .item-l { font-size: 12.5px; font-weight: 650; color: #14161d; }
  .item-r { font-size: 11.5px; color: #5b6373; margin-top: 2px; line-height: 1.35; }
  .foot {
    font-size: 11.5px; color: #5b6373; padding-top: 10px;
    border-top: 1px solid rgba(18,22,32,.09); margin-top: 4px;
  }

  /* ── stat tiles ── */
  .stats { display: flex; gap: 12px; }
  .stat {
    background: rgba(255,255,255,.9); border-radius: 12px; padding: 14px 20px;
    text-align: center; box-shadow: 0 8px 22px -10px rgba(10,8,40,.28);
  }
  .stat b { display: block; font-size: 30px; font-weight: 700; color: #14133a; letter-spacing: -.02em; }
  .stat span {
    font-size: 10.5px; font-weight: 700; letter-spacing: .1em;
    text-transform: uppercase; color: #5b6373;
  }

  /* ── feature rows ── */
  .frow {
    display: flex; align-items: center; justify-content: flex-end; gap: 12px;
    margin-top: 12px; font-size: 14.5px; font-weight: 600;
  }
  .fdot {
    width: 30px; height: 30px; border-radius: 99px; flex: none;
    display: flex; align-items: center; justify-content: center; font-size: 14px;
  }
`;

/** Traffic lights + a URL pill.
 *  @param {string} url */
const chrome_ = (url) => `
  <div class="bar">
    <span class="dot" style="background:#ff5f57"></span>
    <span class="dot" style="background:#febc2e"></span>
    <span class="dot" style="background:#28c840"></span>
    <span class="url">${url}</span>
  </div>`;

/** @param {string} label @param {string} value @param {string} [state] */
const field = (label, value, state = '') => `
  <div class="field">
    <div class="flabel">${label}</div>
    <div class="fbox ${state}">${value}</div>
  </div>`;

/** The AutoApply mark, drawn inline so it scales to any size.
 *  @param {number} size @param {number} [radius] */
const mark = (size, radius = size * 0.22) => `
  <div style="width:${size}px;height:${size}px;border-radius:${radius}px;
              background:${C.indigo};display:flex;flex-direction:column;
              justify-content:center;gap:${size * 0.13}px;padding:0 ${size * 0.22}px;
              box-shadow:0 ${size * 0.08}px ${size * 0.22}px rgba(79,70,229,.42)">
    <div style="height:${size * 0.1}px;border-radius:99px;background:#fff;width:100%"></div>
    <div style="height:${size * 0.1}px;border-radius:99px;background:#fff;width:55%;opacity:.72"></div>
  </div>`;

// ── the review panel, used on two slides ────────────────────────────────────

const reviewPanel = `
  <div class="panel">
    <div class="panel-h">
      <div class="panel-t">AutoApply</div>
      <div class="chips">
        <span class="chip ok">28 filled</span>
        <span class="chip mut">6 skipped</span>
        <span class="chip warn">2 required left</span>
      </div>
    </div>
    <div class="panel-b">
      <div class="sec">Needs you · 3</div>
      <div class="item req">
        <div class="item-l">I agree to the privacy policy</div>
        <div class="item-r">Consent and acknowledgement boxes are yours to tick.</div>
      </div>
      <div class="item req">
        <div class="item-l">Why do you want to work here?</div>
        <div class="item-r">No profile field matches this question.</div>
      </div>
      <div class="item">
        <div class="item-l">Create a password</div>
        <div class="item-r">Sensitive field — AutoApply never fills this.</div>
      </div>
      <div class="foot">Nothing has been submitted. Review the form, then submit it yourself.</div>
    </div>
  </div>`;

// ── slides ──────────────────────────────────────────────────────────────────

/** 1 — the hero. What it does, in one picture. */
const shot1 = () => `
<div class="stage deep" style="${DEEP_BG}">
  <div style="position:absolute;left:76px;top:196px;width:440px">
    <div class="eyebrow">Chrome extension</div>
    <div class="display" style="font-size:66px;margin-top:18px">
      Apply in<br><em>one click.</em>
    </div>
    <div class="lede" style="font-size:17.5px;margin-top:22px">
      AutoApply fills the forty fields every job application asks for — from a
      profile that never leaves your computer.
    </div>
    <!-- Deliberately not a list of the six ATS brand names. The store's keyword
         spam policy covers screenshots and promotional images as well as the
         description, and "lists of sites/brands/keywords without substantial
         added value" is the exact wording it is judged against — a row of brand
         names in an image is that with no room for the context that would
         justify it. The supported sites are named once, in prose, in the
         listing description instead. -->
    <div style="display:inline-flex;align-items:center;gap:9px;margin-top:28px;
                padding:11px 18px;border-radius:99px;
                background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.22);
                color:#fff;font-size:14px;font-weight:600">
      <span style="width:8px;height:8px;border-radius:99px;background:#4ade80"></span>
      Works on the major job boards
    </div>
  </div>

  <!-- The panel is a child of the window so both sit on the same 3D plane, and
       is placed well inside its right edge — the whole point of this slide is
       that you can read the refusals. -->
  <div class="win" style="position:absolute;left:596px;top:84px;width:672px;height:664px;
       transform:perspective(2200px) rotateY(-12deg) rotateZ(-1.3deg)">
    ${chrome_('jobs.northwind.example/apply')}
    <div style="padding:24px 28px">
      <div style="font-family:Georgia,serif;font-size:22px;color:#14161d;margin-bottom:3px">
        Senior Platform Engineer
      </div>
      <div style="font-size:12.5px;color:#5b6373;margin-bottom:20px">Northwind Labs · Remote</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 18px">
        ${field('First name', 'Ada', 'filled')}
        ${field('Last name', 'Lovelace', 'filled')}
        ${field('Email', 'ada@example.com', 'filled')}
        ${field('Phone', '+1 555 010 1842', 'filled')}
        ${field('LinkedIn', 'linkedin.com/in/ada', 'filled')}
        ${field('Current company', 'Analytical Engines', 'filled')}
      </div>
      ${field('Why do you want to work here?', 'Left for you to answer', 'flag empty')}
    </div>
    <div style="position:absolute;left:330px;top:286px">${reviewPanel}</div>
  </div>
</div>`;

/** 2 — the review panel, which is the whole argument for the product. */
const shot2 = () => `
<div class="stage pale" style="${PALE_BG}">
  <div style="position:absolute;left:46px;top:150px;
       transform:perspective(1900px) rotateY(11deg) rotateZ(1.1deg) scale(1.58);
       transform-origin:left center">
    ${reviewPanel}
  </div>

  <div style="position:absolute;right:78px;top:238px;width:470px;text-align:right">
    <div class="eyebrow">The review panel</div>
    <div class="display" style="font-size:62px;margin-top:18px">
      Every skip,<br><em>explained.</em>
    </div>
    <div class="lede" style="font-size:17px;margin-top:22px">
      Other autofill tools guess, and you find out after you hit submit.
      AutoApply refuses out loud and tells you why.
    </div>
    <div class="frow">
      <span style="color:#14133a">Filled fields outlined in the page</span>
      <span class="fdot" style="background:#dcfce7;color:#16794a">✓</span>
    </div>
    <div class="frow">
      <span style="color:#14133a">Every skipped field, with its reason</span>
      <span class="fdot" style="background:#fef3c7;color:#8a5a00">!</span>
    </div>
    <div class="frow">
      <span style="color:#14133a">Click any item to jump to that field</span>
      <span class="fdot" style="background:#e0e7ff;color:${C.indigo}">↗</span>
    </div>
  </div>
</div>`;

/** 3 — the refusals. The trust slide. */
const shot3 = () => {
  /** @param {string} icon @param {string} tint @param {string} title @param {string} body */
  const card = (icon, tint, title, body) => `
    <div style="flex:1;background:rgba(255,255,255,.97);border-radius:16px;padding:26px 24px;
                box-shadow:0 26px 50px -22px rgba(10,8,40,.6)">
      <div style="width:42px;height:42px;border-radius:11px;background:${tint};
                  display:flex;align-items:center;justify-content:center;
                  font-size:20px;margin-bottom:16px">${icon}</div>
      <div style="font-family:Georgia,serif;font-size:21px;color:#14133a;margin-bottom:9px">${title}</div>
      <div style="font-size:14px;line-height:1.55;color:#4b5168">${body}</div>
    </div>`;

  return `
<div class="stage deep" style="${DEEP_BG}">
  <div style="position:absolute;left:0;right:0;top:104px;text-align:center">
    <div class="eyebrow">Refuses to guess</div>
    <div class="display" style="font-size:62px;margin-top:16px">
      It never <em>submits.</em>
    </div>
    <div class="lede" style="font-size:17px;margin-top:20px;max-width:640px;margin-left:auto;margin-right:auto">
      There is no submit control anywhere in this extension. A wrong answer on a
      job application is worse than a blank one, so it leaves the ones it cannot
      be sure of.
    </div>
  </div>

  <div style="position:absolute;left:78px;right:78px;top:352px;display:flex;gap:22px">
    ${card('🔒', '#ede9fe', 'Never fills sensitive fields',
      'Passwords, SSN, bank and card details, passport and date of birth are refused outright.')}
    ${card('☑', '#fef3c7', 'Never ticks a checkbox',
      'Almost every standalone checkbox is a consent or an acknowledgement. Those are yours.')}
    ${card('📎', '#dcfce7', 'Only ever attaches a résumé',
      'And only where the label asks for one. Cover letters and transcripts are left alone.')}
  </div>

  <div style="position:absolute;left:0;right:0;bottom:74px;text-align:center">
    <div style="display:inline-flex;align-items:center;gap:11px;padding:13px 24px;
                border-radius:99px;background:rgba(255,255,255,.09);
                border:1px solid rgba(255,255,255,.20);color:#fff;
                font-size:15px;font-weight:600">
      <span style="width:8px;height:8px;border-radius:99px;background:#4ade80"></span>
      Zero network requests · No account · No analytics
    </div>
  </div>
</div>`;
};

/** 4 — the tracker. */
const shot4 = () => {
  /** @param {string} role @param {string} company @param {string} stage
   *  @param {string} colour @param {string} applied @param {string} age
   *  @param {boolean} [stale] */
  const row = (role, company, stage, colour, applied, age, stale = false) => `
    <tr>
      <td style="padding:11px 12px;font-weight:650;color:#14161d;font-size:13.5px">${role}</td>
      <td style="padding:11px 12px;color:#4b5168;font-size:13px">${company}</td>
      <td style="padding:11px 12px">
        <span style="display:inline-flex;align-items:center;gap:7px;font-size:12.5px;
                     font-weight:650;color:#4b5168">
          <span style="width:8px;height:8px;border-radius:99px;background:${colour}"></span>${stage}
        </span>
      </td>
      <td style="padding:11px 12px;color:#5b6373;font-size:12.5px">${applied}</td>
      <td style="padding:11px 12px;font-size:12.5px;font-weight:${stale ? 650 : 400};
                 color:${stale ? '#b45309' : '#5b6373'}">${age}</td>
    </tr>`;

  return `
<div class="stage pale" style="${PALE_BG}">
  <div class="win" style="position:absolute;left:-26px;top:104px;width:790px;height:508px;
       transform:perspective(2100px) rotateY(10deg) rotateZ(.9deg)">
    ${chrome_('chrome-extension://autoapply/tracker')}
    <div style="padding:26px 30px">
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px">
        <div style="font-family:Georgia,serif;font-size:25px;color:#14161d">Job tracker</div>
      </div>
      <div style="font-size:12.5px;color:#5b6373;margin-bottom:20px">
        18 applications · 11 still open · 2 with no movement in 21+ days
      </div>
      <table style="width:100%;border-collapse:collapse">
        <tr style="border-bottom:1px solid #cfd3de">
          ${['Role', 'Company', 'Stage', 'Applied', 'In stage']
            .map(
              (h) =>
                `<th style="text-align:left;padding:7px 12px;font-size:10.5px;font-weight:800;
                 letter-spacing:.07em;text-transform:uppercase;color:#5b6373">${h}</th>`,
            )
            .join('')}
        </tr>
        ${row('Senior Software Engineer', 'Northwind Labs', 'Interview', '#d97706', 'Aug 25', '2 days')}
        ${row('Staff Engineer, Edge', 'Kestrel Systems', 'Screening', '#0891b2', 'Aug 22', '5 days')}
        ${row('Senior Product Engineer', 'Meridian', 'Applied', '#2563eb', 'Aug 19', '8 days')}
        ${row('SWE, Payments', 'Lumen Works', 'Offer', '#16a34a', 'Aug 6', '3 weeks', true)}
        ${row('Engineering Manager', 'Harborline', 'Draft', '#94a3b8', 'Aug 27', 'today')}
        ${row('Senior Frontend Engineer', 'Vantage Bio', 'Rejected', '#dc2626', 'Jul 28', '—')}
      </table>
    </div>
  </div>

  <div style="position:absolute;right:74px;top:222px;width:452px;text-align:right">
    <div class="eyebrow">Built-in job tracker</div>
    <div class="display" style="font-size:58px;margin-top:18px">
      Nothing<br><em>slips.</em>
    </div>
    <div class="lede" style="font-size:16.5px;margin-top:20px">
      Every fill logs itself. Stages, notes and CSV export — plus a nudge when
      something has gone quiet for three weeks.
    </div>
    <div class="stats" style="justify-content:flex-end;margin-top:26px">
      <div class="stat"><b>18</b><span>Tracked</span></div>
      <div class="stat"><b>11</b><span>Open</span></div>
      <div class="stat"><b>2</b><span>Stale</span></div>
    </div>
  </div>
</div>`;
};

/** 5 — the profile, and the privacy promise. */
const shot5 = () => `
<div class="stage deep" style="${DEEP_BG}">
  <div style="position:absolute;left:76px;top:184px;width:452px">
    <div class="eyebrow">Set up once</div>
    <div class="display" style="font-size:60px;margin-top:18px">
      Forty facts,<br><em>typed once.</em>
    </div>
    <div class="lede" style="font-size:17px;margin-top:22px">
      Your details and your résumés live in your browser's own storage on your
      machine. No account, no server, no analytics.
    </div>
    <div style="margin-top:30px;padding:20px 22px;border-radius:14px;
                background:rgba(255,255,255,.09);border:1px solid rgba(255,255,255,.20)">
      <div style="display:flex;align-items:center;gap:10px;color:#fff;
                  font-size:16px;font-weight:700;margin-bottom:8px">
        <span style="font-size:19px">🔒</span> Zero network requests
      </div>
      <div style="font-size:14px;line-height:1.55;color:rgba(255,255,255,.72)">
        There is no <code style="font-family:Consolas,monospace;font-size:13px">fetch</code>
        and no <code style="font-family:Consolas,monospace;font-size:13px">XMLHttpRequest</code>
        anywhere in the code, and no third-party dependency that could add one.
      </div>
    </div>
  </div>

  <div class="win" style="position:absolute;left:614px;top:112px;width:648px;height:506px;
       transform:perspective(2200px) rotateY(-12deg) rotateZ(-1.2deg)">
    ${chrome_('chrome-extension://autoapply/options')}
    <div style="padding:26px 30px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div style="font-family:Georgia,serif;font-size:24px;color:#14161d">AutoApply profile</div>
        <div style="font-size:12px;color:#5b6373">34 of 39 fields</div>
      </div>
      <div style="height:5px;border-radius:99px;background:#eceef4;margin-bottom:22px">
        <div style="height:100%;width:87%;border-radius:99px;background:${C.indigo}"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 18px">
        ${field('First name', 'Ada')}
        ${field('Last name', 'Lovelace')}
        ${field('Email', 'ada@example.com')}
        ${field('City', 'London')}
        ${field('Current company', 'Analytical Engines')}
        ${field('Current title', 'Principal Engineer')}
      </div>
      <div style="margin-top:6px;padding:13px 15px;border-radius:10px;background:#f7f7fb;
                  border:1px solid #e5e7ee;box-shadow:inset 3px 0 0 ${C.indigo};
                  display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:13.5px;font-weight:650;color:#14161d">General résumé</div>
          <div style="font-size:12px;color:#5b6373;margin-top:2px">ada-lovelace.pdf · 184 KB</div>
        </div>
        <span style="padding:3px 10px;border-radius:99px;background:#e6f5ec;color:#16794a;
                     font-size:11px;font-weight:700">Default</span>
      </div>
    </div>
  </div>
</div>`;

/** Small promo tile. Has to survive being shrunk to 220×140. */
const promoSmall = () => `
<div class="stage deep" style="${DEEP_BG};display:flex;align-items:center;gap:22px;padding:0 34px">
  ${mark(84, 20)}
  <div>
    <div style="font-size:34px;font-weight:700;color:#fff;letter-spacing:-.02em;line-height:1">
      AutoApply
    </div>
    <div style="font-size:15px;color:rgba(255,255,255,.80);margin-top:9px;line-height:1.4">
      Fills job applications<br>from your own computer.
    </div>
    <div style="display:inline-block;margin-top:12px;padding:5px 12px;border-radius:99px;
                background:rgba(251,191,36,.16);border:1px solid rgba(251,191,36,.42);
                color:${C.amber};font-size:12px;font-weight:700">
      Never submits for you
    </div>
  </div>
</div>`;

/** Marquee tile. Wide, and read at a glance while scrolling. */
const promoMarquee = () => `
<div class="stage deep" style="${DEEP_BG}">
  <div style="position:absolute;left:92px;top:118px;width:660px">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:26px">
      ${mark(62, 15)}
      <div style="font-size:31px;font-weight:700;color:#fff;letter-spacing:-.02em">AutoApply</div>
    </div>
    <div class="display" style="font-size:60px">
      Fifteen minutes<br>of forms, in <em>one click.</em>
    </div>
    <div class="lede" style="font-size:18px;margin-top:22px;max-width:560px">
      Fills what it is certain about, tells you what it skipped and why, and
      stops short of the submit button. Your data never leaves your machine.
    </div>
  </div>

  <div class="win" style="position:absolute;left:806px;top:66px;width:556px;height:470px;
       transform:perspective(1900px) rotateY(-13deg) rotateZ(-1.4deg)">
    ${chrome_('jobs.northwind.example/apply')}
    <div style="padding:20px 24px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">
        ${field('First name', 'Ada', 'filled')}
        ${field('Last name', 'Lovelace', 'filled')}
      </div>
      ${field('Create a password', 'Never filled', 'flag empty')}
    </div>
    <div style="position:absolute;left:214px;top:118px;transform:scale(.78);transform-origin:top left">
      ${reviewPanel}
    </div>
  </div>
</div>`;

/** Store icon: 96×96 of mark centred in 128×128, leaving 16px transparent. */
const storeIcon = () => `
<div style="width:128px;height:128px;display:flex;align-items:center;justify-content:center;
            background:transparent">
  <div style="width:96px;height:96px;border-radius:22px;background:${C.indigo};
              display:flex;flex-direction:column;justify-content:center;gap:12px;padding:0 21px">
    <div style="height:10px;border-radius:99px;background:#fff;width:100%"></div>
    <div style="height:10px;border-radius:99px;background:#fff;width:55%;opacity:.72"></div>
  </div>
</div>`;

// ── the asset list ──────────────────────────────────────────────────────────

const ASSETS = [
  { file: 'store-icon-128.png', w: 128, h: 128, html: storeIcon, transparent: true },
  { file: 'screenshot-1-fill.png', w: 1280, h: 800, html: shot1 },
  { file: 'screenshot-2-review.png', w: 1280, h: 800, html: shot2 },
  { file: 'screenshot-3-refuses.png', w: 1280, h: 800, html: shot3 },
  { file: 'screenshot-4-tracker.png', w: 1280, h: 800, html: shot4 },
  { file: 'screenshot-5-profile.png', w: 1280, h: 800, html: shot5 },
  { file: 'promo-small-440x280.png', w: 440, h: 280, html: promoSmall },
  { file: 'promo-marquee-1400x560.png', w: 1400, h: 560, html: promoMarquee },
];

// ── plumbing ────────────────────────────────────────────────────────────────

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

/** @param {{w: number, h: number, html: () => string, transparent?: boolean}} asset */
function page(asset) {
  return `<!doctype html><meta charset="utf-8"><style>
    ${BASE_CSS}
    html, body { width:${asset.w}px; height:${asset.h}px;
                 background:${asset.transparent ? 'transparent' : '#fff'}; }
  </style>${asset.html()}`;
}

async function main() {
  const chrome = findChromeForTesting();
  if (!chrome) {
    throw new Error('Chrome for Testing not found. Install it with:\n  npm run drive:setup');
  }

  mkdirSync(outDir, { recursive: true });

  const userDataDir = await mkdtemp(join(tmpdir(), 'autoapply-store-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
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
    const target = targets.find((/** @type {any} */ t) => t.type === 'page');
    if (!target) throw new Error('no page target');

    const cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.ready();
    await cdp.send('Page.enable');

    for (const asset of ASSETS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: asset.w,
        height: asset.h,
        deviceScaleFactor: 1,
        mobile: false,
      });

      // The --default-background-color launch flag does not survive into the
      // capture on current Chrome builds, so the alpha channel has to be asked
      // for here. Without it the store icon's 16px of padding is opaque white
      // and the mark sits in a white square on a dark toolbar.
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: asset.transparent
          ? { r: 0, g: 0, b: 0, a: 0 }
          : { r: 255, g: 255, b: 255, a: 1 },
      });

      const html = page(asset).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      await cdp.send('Runtime.evaluate', {
        expression: `document.open(); document.write(\`${html}\`); document.close();`,
      });
      await sleep(320);

      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: asset.w, height: asset.h, scale: 1 },
      });

      await writeFile(join(outDir, asset.file), Buffer.from(shot.data, 'base64'));
      console.log(`✓ ${String(asset.w).padStart(4)}×${String(asset.h).padEnd(4)} → store/${asset.file}`);
    }
  } finally {
    child.kill();
  }
}

main().catch((error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
