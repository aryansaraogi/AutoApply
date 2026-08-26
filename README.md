<div align="center">

<!-- Drop your 128px icon here — fastest way to make this page look shipped. -->
<!-- <img src="icons/icon128.png" width="88" alt="AutoApply"> -->

# AutoApply

### Fills job applications from a profile on your machine

You review, then you submit. Every field it fills is outlined; every field it skips comes with a reason.

<br>

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Install-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](#)
&nbsp;
[![Privacy](https://img.shields.io/badge/Privacy-Zero%20network%20requests-1a7f37?style=for-the-badge)](PRIVACY.md)

<br>

![Manifest V3](https://img.shields.io/badge/Manifest-V3-4285F4?logo=googlechrome&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-2%20builds-646CFF?logo=vite&logoColor=white)
![Tests](https://img.shields.io/badge/tests-230-brightgreen)
![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-success)
![ATS adapters](https://img.shields.io/badge/ATS%20adapters-6-blueviolet)

<br>

<!-- The single highest-value addition to this page. 10 seconds: fill → review overlay → tracker. -->
<!-- <img src="docs/demo.gif" alt="AutoApply filling a form, showing the review overlay, and logging to the tracker" width="760"> -->

</div>

---

## The problem

An application form is fifteen minutes of retyping the same forty facts about yourself, and the tenth one of the day is where last week's cover letter goes into the wrong company's box.

Autofill tools solve this by guessing — and guessing wrong on a job application is expensive, because you don't find out until after you've hit submit.

**AutoApply is built the other way round.** It fills what it is certain about, refuses everything else out loud, and stops short of the submit button so a human always sees the form before it goes.

---

## Contents

[How it works](#how-it-works) · [Supported sites](#supported-sites) · [Résumés](#résumés) · [Job tracker](#job-tracker) · [What it will not do](#what-it-deliberately-will-not-do) · [Privacy](#-privacy) · [Architecture](#architecture) · [Known limitations](#known-limitations)

---

## How it works

<table>
<tr>
<td width="33%" valign="top">

### 1 · Set up once

Fill in your profile — around 40 fields — and add your résumés. It all lives in `chrome.storage.local` on your machine.

</td>
<td width="33%" valign="top">

### 2 · Fill

Open an application and click **Fill this page**. Filled fields are outlined in the page; skipped ones are listed with the reason they were skipped.

</td>
<td width="33%" valign="top">

### 3 · Review and submit

You check the form and press submit. The extension has no submit control anywhere in it. The application lands in your tracker automatically.

</td>
</tr>
</table>

### Getting started

| # | Step |
|---|---|
| 1 | Install from the Chrome Web Store |
| 2 | The profile page opens on first install — fill it in and add a résumé |
| 3 | Open a job application and click the AutoApply toolbar icon for the side panel |
| 4 | **Fill this page** → review the highlights → submit it yourself |

On a site outside the supported list, the side panel offers **Enable AutoApply on this site**, which requests access to that one origin and turns on the generic form handling there.

<details>
<summary><b>Or grant every site once</b></summary>

<br>

Applying through company careers pages means a new origin almost every time — and Chrome will not reveal a page's address until the extension already has access to it, so the per-site button cannot always name the site it is offering to turn on.

**Profile → Run on any site → Every site** grants `http(s)://*/*` in one prompt. AutoApply then registers itself on every page you open and the per-site step disappears.

It is entirely opt-in, never requested at install, and the same switch takes it back — revoking unregisters it everywhere outside the supported boards. Chrome does not inject into tabs that are already open, so a page loaded before you granted access still needs one click; reload it and it runs on its own from then on.

</details>

---

## Supported sites

| Site | How it is recognised |
|---|---|
| **Greenhouse** | `*.greenhouse.io`, or the embedded `#grnhse_app` board on a company domain |
| **Lever** | `jobs.lever.co` |
| **Ashby** | `jobs.ashbyhq.com` |
| **Workable** | `apply.workable.com` |
| **SmartRecruiters** | `jobs.smartrecruiters.com` |
| **Workday** | `*.myworkdayjobs.com` |
| **Anything else** | Generic fallback, once enabled for that site — works on any form built from standard controls |

Roughly 40 profile fields are covered: identity, contact, address, links, current role, education, salary and start-date preferences, work eligibility, and the US EEO voluntary disclosures.

---

## Résumés

Add your `.pdf` / `.docx` / `.doc` / `.rtf` / `.txt` résumés on the profile page. They are stored on your machine and attached automatically during a fill, so the last manual step of an application goes away too.

Multiple résumés are supported — mark one as the default and it is the one that gets attached. AutoApply is deliberately conservative about which upload it will touch:

| Field | Behaviour |
|---|---|
| "Resume", "CV", "Curriculum Vitae" | ✅ &nbsp;Attached |
| "Cover letter" | ⬜ &nbsp;Left to you |
| "Resume **and** cover letter" | ⬜ &nbsp;Left to you — too ambiguous to guess |
| Portfolio, transcript, photo, work sample | ⬜ &nbsp;Left to you |

It also honours the field's `accept` list: if a form takes only `.doc`/`.docx` and your default is a PDF, it reports that instead of attaching a file the form would reject at submit time.

---

## Job tracker

Every fill creates a tracker entry automatically. **Open tracker** in the side panel opens the full view: search across company, role and notes; filter by stage; sort; export CSV.

```
Draft → Applied → Screening → Interview → Offer → Rejected / Withdrawn
```

A record starts as **Draft** and advances to **Applied** automatically when a submit is detected. From there the stage is yours to set.

> [!IMPORTANT]
> The automatic advance is strictly **one-way**. A record you have moved to Interview is never dragged back to Applied because the page fired another submit event.

Company, role and notes are editable in place. Company and role are *guesses* — careers pages are not built to be read by a machine, and a marketing headline or a routing segment in the URL can beat the real job title — so every guessed field is directly correctable, and **a correction you type is never overwritten by a later fill of the same posting.**

---

## What it deliberately will not do

These are design decisions, not gaps. Each one is a place where guessing would have been easy and wrong.

| | |
|---|---|
| 🚫 **Never submits** | There is no submit control anywhere in the extension. |
| 🚫 **Never ticks a checkbox** | Nearly every standalone checkbox on an application is a consent or an acknowledgement. Those are yours. |
| 📎 **Only ever attaches a résumé** | And only to a field whose label asks for one. Cover letters, transcripts, portfolios and ambiguous combined uploads are left alone. |
| 🔒 **Never fills sensitive fields** | Passwords, SSN / national insurance, bank or card details, passport, driver's licence, date of birth. |
| ❓ **Refuses compound eligibility questions** | *"Are you legally authorized to work in the US **without sponsorship**?"* folds together two profile answers that can disagree, so it is surfaced for you rather than guessed at. |
| ✍️ **Leaves company-specific prompts blank** | *"Why do you want to work here?"* does not get your stored default cover letter. |
| 🛡️ **Never overwrites** | A value you typed yourself stays put. |
| 🤷 **Refuses to guess** | When two rules match a field about equally well, it reports the field as ambiguous instead of picking one. |

Everything skipped appears in the review panel **with its reason**, so *"why is this still empty?"* always has an answer on screen.

---

## 🔒 Privacy

<div align="center">

### Zero network requests. No account, no server, no analytics.

</div>

There is no `fetch` and no `XMLHttpRequest` in the codebase, and no third-party runtime dependency that could add one. Your profile, your résumés and your application history live in `chrome.storage.local` on your own machine and never leave it.

The all-sites permission is opt-in, never requested at install, and revocable from the same switch that grants it.

→ [**Full privacy policy**](PRIVACY.md)

---

## Architecture

```
src/
  core/       harvest → label → match → fill.  No DOM writes outside setValue.
  adapters/   per-ATS quirks; the combobox driver lives here
  ui/         options page, side panel, job tracker, in-page review overlay
  storage/    profile schema, settings, résumés, application log, site access
  background/ service worker: message router, and the content script
              registration that follows your site-access choice
  content/    the only code that touches the page
```

TypeScript throughout, no runtime dependencies. Two Vite builds, because MV3 content scripts cannot be ES modules: one produces the service worker and the two pages, the other produces a single self-contained `content.js`.

### How a fill works

| Stage | What happens |
|---|---|
| **1 · harvest** | Walks the document and any open shadow roots, groups radios into one logical field each, and describes every control |
| **2 · label** | Resolves each field's name through a priority chain, from `aria-labelledby` down to a nearby text node |
| **3 · match** | Scores the rule table against the label, `autocomplete` token and `name`/`id` — and **refuses when the top two candidates are too close** |
| **4 · fill** | Writes through the prototype's native setter and rewinds React's value tracker, so framework-controlled inputs actually register the change |
| **5 · overlay** | Outlines what changed and lists what still needs you |

### How the content script gets there

Three routes — which is why it guards against loading twice. Two copies in one frame would both answer `FILL_PAGE`, filling the form twice and logging two records for one application.

| Route | When |
|---|---|
| `content_scripts` in the manifest | The six declared boards, always |
| `chrome.scripting.registerContentScripts` | Everywhere else, while all-site access is granted. The service worker registers and unregisters it as the permission changes, and excludes the declared hosts so no frame gets both |
| `chrome.scripting.executeScript` | The side panel's per-site button, and for a page that was already open when access was granted — Chrome does not inject into tabs that have already loaded |

### The adapter contract

An adapter may change **where** fields are looked for and **how** a widget is driven — but never **what value goes where**. That stays in the shared rule table, so a fix benefits every site rather than one.

Declared hostnames live in `public/manifest.json`, and the all-site registration reads those `matches` back out at runtime to exclude them — so there is no second list to keep in sync by hand.

### Testing

230 unit and integration tests, plus a browser harness that loads the real extension, seeds a profile, fills a fixture form and drives the tracker end to end. The fixture mirrors the markup patterns real ATS forms use, **including planted decoys** the matcher is expected to refuse.

The harness exists because jsdom cannot reach two things that have both produced real bugs the unit tests passed straight through: **attaching a file** (there is no `DataTransfer` in jsdom) and **`requestAnimationFrame` timing**.

---

## Known limitations

- **Submission tracking is best-effort.** A history entry is promoted from `filled` to `submitted` on a form submit event or a click on a submit-looking button. A single-page app that posts via `fetch` without either signal stays at `filled`.
- **The ATS-specific selectors are unverified against live sites.** Adapter routing (hostnames, Greenhouse's embed markers, Workday's `data-automation-id`) is covered by tests, but the company/role selectors inside each adapter are best-effort and were written without access to a live posting. They fall back to the generic heuristics when they miss, so a stale selector degrades the history label rather than breaking the fill.
- **One frame answers per page.** Only the frame containing form fields responds, which is right for the embedded-iframe case but under-reports if a page somehow has application forms in two frames at once.
- **A `chrome://` page is indistinguishable from a job page** until you have granted every site. Chrome redacts the URL of both identically, so the side panel offers to turn AutoApply on there too. Once every site is granted, a URL Chrome still will not reveal can only be one of its own pages, and the panel says so instead.
- **Storage writes are serialised per context, not globally.** Every tracker edit runs in the tracker page, so edits cannot overwrite each other. Two *different* contexts writing in the same instant — a fill recording a record while you have the tracker open — could still interleave, because `chrome.storage` offers no compare-and-swap. They touch different records, and a company or role you typed yourself is protected explicitly.
- **No LinkedIn Easy Apply**, no cloud sync, no résumé *generation* — it attaches the file you stored, it does not write one for you.

---

<div align="center">

[**Install**](#) &nbsp;·&nbsp; [**Privacy**](PRIVACY.md)

*Built to be reviewed, not trusted.*

</div>