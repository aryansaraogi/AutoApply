# AutoApply

A Chrome extension that fills job applications from a profile stored on your own
machine, shows you exactly what it filled and what it skipped, and records every
application in a local history.

**It never submits a form.** You review, then you submit.

---

## Quick start

```bash
npm install
npm run build
```

Then load it:

1. Open `chrome://extensions` and switch on **Developer mode**
2. **Load unpacked** → select the `dist/` folder
3. The options page opens on first install — fill in your profile
4. Open a job application and click the AutoApply toolbar icon to open the side panel
5. Click **Fill this page**, review the highlighted fields, submit it yourself

To try it without touching a real posting:

```bash
npm run fixtures        # serves fixtures/ on http://localhost:4321
```

Open `http://localhost:4321/sample-application.html`, then in the side panel click
**Enable AutoApply on this site** and accept the permission prompt. The fixture
mirrors the markup patterns real ATS forms use — including planted decoys — and
intercepts its own submit.

That same button is how you use AutoApply on any site outside the supported list:
it requests access to that one origin and starts the generic form handling there.

### Or grant every site once

Applying through company careers pages means a new origin almost every time, and
Chrome will not even reveal a page's address until the extension has access to
it — so the per-site button cannot always name the site it is offering to turn
on. **Profile → Run on any site → Every site** grants `http(s)://*/*` in one
prompt. AutoApply then registers itself on every page you open, and the per-site
step disappears.

It is entirely opt-in, never requested at install, and the same switch takes it
back — revoking unregisters it everywhere outside the supported boards listed
below. Chrome does not inject into tabs that are already open, so a page loaded
before you granted access still needs one click; reload it and it runs on its
own from then on.

---

## What it supports

| Site | How it is recognised |
|---|---|
| Greenhouse | `*.greenhouse.io`, or the embedded `#grnhse_app` board on a company domain |
| Lever | `jobs.lever.co` |
| Ashby | `jobs.ashbyhq.com` |
| Workable | `apply.workable.com` |
| SmartRecruiters | `jobs.smartrecruiters.com` |
| Workday | `*.myworkdayjobs.com` |
| Anything else | Generic fallback, after you click **Enable AutoApply on this site** — works on any form built from standard controls |

Roughly 40 profile fields are covered: identity, contact, address, links, current
role, education, salary and start-date preferences, work eligibility, and the US
EEO voluntary disclosures.

## Résumés

Add your `.pdf` / `.docx` / `.doc` / `.rtf` / `.txt` résumés on the profile page.
They are stored on your machine and attached automatically to résumé uploads
during a fill, so the last manual step of an application goes away too.

Multiple résumés are supported — mark one as the default and it is the one that
gets attached. Deliberately conservative about which upload it will touch:

| Field | Behaviour |
|---|---|
| "Resume", "CV", "Curriculum Vitae" | Attached |
| "Cover letter" | Left to you |
| "Resume **and** cover letter" | Left to you — too ambiguous to guess |
| Portfolio, transcript, photo, work sample | Left to you |

It also honours the field's `accept` list: if a form takes only `.doc`/`.docx`
and your default is a PDF, it reports that instead of attaching a file the form
would reject at submit time.

## Job tracker

Every fill creates a tracker entry automatically. **Open tracker** in the side
panel opens the full view: search across company, role and notes; filter by
stage; sort; export CSV.

Company, role and notes are all editable in place. Company and role are *guesses*
— careers pages are not built to be read by a machine, and a marketing headline
or a routing segment in the URL can win over the real job title — so every
guessed field is directly correctable, and a correction you type is never
overwritten by a later fill of the same posting.

```
Draft → Applied → Screening → Interview → Offer → Rejected / Withdrawn
```

A record starts as **Draft** and is advanced to **Applied** automatically when a
submit is detected. From there the stage is yours to set. The automatic
advance is strictly one-way — a record you have moved to Interview is never
dragged back to Applied because the page fired another submit event.

## What it deliberately will not do

These are design decisions, not gaps:

- **Never submits.** There is no submit control anywhere in the extension.
- **Never ticks a checkbox.** Nearly every standalone checkbox on an application
  is a consent or acknowledgement. Those are yours.
- **Only ever attaches a résumé** — and only to a field whose label asks for one.
  Cover letters, transcripts, portfolios and ambiguous combined uploads are left
  alone. See [Résumés](#résumés).
- **Never fills sensitive fields** — passwords, SSN/national insurance, bank or
  card details, passport, driver's licence, date of birth.
- **Refuses compound eligibility questions.** "Are you legally authorized to work
  in the US *without sponsorship*?" folds together two profile answers that can
  disagree, so it is surfaced for you rather than guessed at.
- **Leaves company-specific prompts blank.** "Why do you want to work here?" does
  not get your stored default cover letter.
- **Never overwrites** a value you typed yourself.
- **Refuses to guess.** When two rules match a field about equally well, it
  reports the field as ambiguous instead of picking one.

Everything skipped appears in the review panel with the reason, so "why is this
still empty?" always has an answer on screen.

---

## No network access

The extension makes **no network requests of any kind** — there is no `fetch`, no
`XMLHttpRequest`, and no third-party runtime dependency in it. No account, no
server, no analytics. Everything lives in `chrome.storage.local` on your machine.

See [PRIVACY.md](PRIVACY.md).


## Releasing

```bash
npm run icons        # regenerate icons/ (only when the mark changes)
npm run screenshots  # store/ listing images at 1280×800
npm run package      # release build + releases/autoapply-<version>.zip
```

`npm run package` refuses to build if `dist/` contains sourcemaps, TypeScript, or
anything else that should not be published, and checks that `manifest.json` and
`package.json` agree on the version. Everything the Chrome Web Store dashboard
asks for — descriptions, permission justifications, data-use answers — is written
out in [STORE-LISTING.md](STORE-LISTING.md).

---

## Development

```bash
npm run build       # typecheck, build, verify every manifest reference resolves
npm run watch       # rebuild both bundles on change
npm test            # 230 unit + integration tests
npm run typecheck   # tsc for src/ and for the build config, separately
npm run fixtures    # serve fixtures/ for manual testing
npm run drive       # launch Chrome with the extension and fill the fixture
npm run play        # same, but hands you the browser instead of driving it
```

### Driving it automatically

`npm run drive` launches a real browser with the extension loaded, seeds a
profile and a résumé, grants the fixture origin, fills the form, drives the
tracker, and writes three screenshots. It is the only check that exercises the
manifest, the service worker, the content script and `chrome.storage` together.

It also covers two things jsdom fundamentally cannot: **attaching a file** (no
`DataTransfer` in jsdom) and **`requestAnimationFrame` timing**. Both have
already produced real bugs that the unit tests passed straight through.

```bash
npm run drive:setup   # once — downloads Chrome for Testing (~150 MB)
npm run fixtures      # in another terminal
npm run drive
```

**It requires Chrome for Testing, not your installed Chrome.** Chrome removed
`--load-extension` from regular builds in v137 for security: the flag is
*silently ignored*, so you get a browser with only Chrome's own component
extensions loaded and confusing failures (`chrome.storage` undefined,
`ERR_FILE_NOT_FOUND` on your own pages). `drive:setup` fetches the automation
build, which still honours it.

### Checking it by hand

```bash
npm run fixtures   # in another terminal
npm run play
```

Same setup — profile seeded, fixture origin granted, content script injected,
side panel opened — but it fills nothing and leaves the browser running, so
whatever you see next is the result of your own click.

Two things it deliberately does *not* do, both learned the hard way:

- **It seeds no résumé.** The first résumé added becomes the default, so a
  seeded stub would hold that slot and a real résumé you then upload would sit
  second and never be the one attached — test data quietly sabotaging the thing
  under test.
- **It fills nothing.** An automated fill before you look makes it impossible to
  tell your click apart from the script's.

If the panel shows **Profile 0/39**, storage was cleared at some point — fill in
the profile page, or re-run `npm run play`. A fill against an empty profile
reports `0 filled` and looks like a broken extension; the review overlay says
which it is, and no tracker entry is written for an application that never
actually got started.

After a rebuild, press the reload button on the extension card in
`chrome://extensions` — Chrome does not hot-reload unpacked extensions.

### Layout

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

Two Vite builds, because MV3 content scripts cannot be ES modules: `vite.config.ts`
produces the service worker and the two pages, `vite.content.config.ts` produces
a single self-contained `content.js`.

### How the content script gets there

Three routes, which is why it guards against loading twice — two copies in one
frame would both answer `FILL_PAGE`, filling the form twice and logging two
records for one application:

| Route | When |
|---|---|
| `content_scripts` in the manifest | The six declared boards, always |
| `chrome.scripting.registerContentScripts` | Everywhere else, while all-site access is granted. The service worker registers and unregisters it as the permission changes, and excludes the declared hosts so no frame gets both |
| `chrome.scripting.executeScript` | The side panel's per-site button, and for a page that was already open when access was granted — Chrome does not inject into tabs that have already loaded |

### How a fill works

1. **harvest** — walks the document and any open shadow roots, groups radios into
   one logical field each, and describes every control
2. **label** — resolves each field's name through a priority chain, from
   `aria-labelledby` down to a nearby text node
3. **match** — scores the rule table against the label, `autocomplete` token and
   `name`/`id`, and refuses when the top two candidates are too close
4. **fill** — writes through the prototype's native setter and rewinds React's
   value tracker, so framework-controlled inputs actually register the change
5. **overlay** — outlines what changed and lists what still needs you

### Adding a site adapter

Implement `SiteAdapter` (`src/adapters/types.ts`) and add it to the registry.
An adapter may change *where* fields are looked for and *how* a widget is driven,
but never *what value goes where* — that stays in the shared rule table so a fix
benefits every site. Add the hostname to `host_permissions` and `content_scripts`
in `public/manifest.json` — the all-site registration reads those `matches` back
out at runtime to exclude them, so there is nothing to keep in sync by hand.

---

## Known limitations

- **Submission tracking is best-effort.** A history entry is promoted from
  `filled` to `submitted` on a form submit event or a click on a submit-looking
  button. A single-page app that posts via `fetch` without either signal stays at
  `filled`.
- **The ATS-specific selectors are unverified against live sites.** Adapter
  routing (hostnames, Greenhouse's embed markers, Workday's `data-automation-id`)
  is covered by tests, but the company/role selectors inside each adapter are
  best-effort and were written without access to a live posting. They fall back
  to the generic heuristics when they miss, so a stale selector degrades the
  history label rather than breaking the fill. Worth validating against a real
  page per ATS.
- **One frame answers per page.** Only the frame containing form fields responds,
  which is right for the embedded-iframe case but under-reports if a page somehow
  has application forms in two frames at once.
- **A `chrome://` page is indistinguishable from a job page** until you have
  granted every site. Chrome redacts the URL of both identically, so the side
  panel offers to turn AutoApply on there too. Once every site is granted, a URL
  Chrome still will not reveal can only be one of its own pages, and the panel
  says so instead.
- **Storage writes are serialised per context, not globally.** Every tracker edit
  runs in the tracker page, so edits cannot overwrite each other. Two *different*
  contexts writing in the same instant — a fill recording a record while you have
  the tracker open — could still interleave, because `chrome.storage` offers no
  compare-and-swap. They touch different records, and a company or role you typed
  yourself is protected explicitly.
- **No LinkedIn Easy Apply**, no cloud sync, no résumé *generation* — it attaches
  the file you stored, it does not write one for you.
