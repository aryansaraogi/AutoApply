# Chrome Web Store listing — AutoApply 1.0.0

Everything the Developer Dashboard asks for, kept here so it is version-controlled
and identical between submissions. Copy each block into the matching field.

**Visibility: Unlisted.** Not discoverable in search; installable only by link.
Switch to Public later from the same dropdown once you are happy with it.

---

## Contents

[Item details](#item-details) · [Avoiding keyword spam](#avoiding-keyword-spam) · [Graphics](#graphics) · [Single purpose](#single-purpose) ·
[Permission justifications](#permission-justifications) · [Data use](#data-use-disclosures) ·
[Privacy policy hosting](#privacy-policy-hosting) · [Submission checklist](#submission-checklist)

---

## Item details

**Name** — *not a dashboard field.*

```
AutoApply — Job Application Autofill
```

This is `name` in `public/manifest.json`, currently 36 of the 75 characters
allowed. It is **not** editable in the Developer Dashboard:

> "This name appears in the Chrome Web Store and the Chrome browser."
> "After uploading your item, you won't be able to edit the metadata of your
> manifest in the developer dashboard."

So changing it means editing the manifest, running `npm run package`, and
uploading the new zip — there is nothing to paste. `action.default_title` stays
the short "AutoApply", since that is the toolbar tooltip and has no room for a
subtitle.

> ⚠️ "AutoApply" is a crowded name in the job-search space. Store names need not
> be unique so this will not block submission, but search for conflicts before
> building an identity on it — a trademark complaint after publishing is far more
> annoying than renaming now.

**Short description** (132 characters max — this is 110)
```
Fills job applications from a profile stored on your own computer. Shows what it filled. Never submits for you.
```

**Category:** Productivity  ·  **Language:** English

**Detailed description**
```
AutoApply fills in job application forms from a profile you keep on your own
computer, then shows you exactly what it filled and what it left alone.

It never submits anything. You review the form and press submit yourself.

WHAT IT DOES

• Fills the fields every application asks for — name, contact details, address,
  links, current role, education, salary and start-date preferences, work
  eligibility, and the voluntary equal-opportunity questions.
• Attaches your résumé to résumé uploads, so the last manual step goes too.
• Highlights every field it touched, and lists what still needs you and why.
  The review panel collapses out of the way and can be moved to either side of
  the window, so it never covers the form you are checking.
• Tracks each application through the stages from draft to offer, with notes
  and CSV export.
• Shows how long each application has sat in its current stage, and flags the
  ones that have not moved in three weeks — so nothing quietly goes cold.

WHERE IT WORKS

Most job postings are served by a handful of applicant tracking systems.
AutoApply recognises the major ones automatically, so opening a posting on one
is enough and there is nothing to switch on. Everywhere else — a company's own
careers page, for instance — one click enables it for that site, where it falls
back to handling any ordinary HTML form.

The exact sites it covers on its own are listed in the permissions Chrome shows
you before you install.

WHAT IT WILL NOT DO

• It does not submit. There is no submit control anywhere in the extension.
• Sensitive fields are refused outright: passwords, social security or national
  insurance numbers, bank or card details, passport or licence numbers, and
  dates of birth.
• Checkboxes are left alone, because almost every one is a consent or an
  acknowledgement and those are yours to agree to.
• A question it cannot answer confidently is handed back to you. "Are you
  legally authorized to work in the US without sponsorship?" folds together two
  answers that can disagree, so it surfaces that one instead of guessing.
• Only a résumé is ever attached, and only to a field whose label asks for one.
  Cover letters, transcripts and portfolios are left alone.

YOUR DATA STAYS WITH YOU

There is no account, no server, and no analytics. The extension makes no network
requests at all — there is no code in it that can. Everything is stored in your
browser on your machine, and removing the extension removes it.

Privacy policy: https://docs.google.com/document/d/1VuqjvcuTQtC1i8NK9U5KWMwsJPoYYfwLl_L3DCAiYgo/preview
```

---

## Avoiding keyword spam

This listing was rejected **twice** under the same policy (violation reference
*Yellow Argon*, routing ID *FZSL*). The second rejection is the instructive one.

### Submission 1

> 🌐 Works with popular job platforms Built-in support for: Greenhouse Lever
> Ashby Workable SmartRecruiters Workday

Six brand names under a heading, no sentence around them. Textbook.

### Submission 2

> Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Workday

This was the *fixed* version — the same six names rewritten into a grammatical
sentence that explained what an applicant tracking system is and what happens on
other sites. It was rejected anyway.

**The lesson: prose around the names does not rescue them.** The rule reads
*"lists of sites/brands/keywords without substantial added value"*, and it is
natural to read "substantial added value" as something the surrounding sentence
can supply. In practice the enumeration itself is what gets flagged. Six brand
names in a row is a list whatever punctuation joins them.

### The rule to follow

**Do not name the supported sites in the description at all.** Describe the
category instead, and point at the permissions, which is where Chrome shows the
user the actual domains before they install — authoritative, and not metadata
you are writing:

```
AutoApply recognises the major ones automatically ...
The exact sites it covers on its own are listed in the permissions Chrome shows
you before you install.
```

The permission justification fields are a separate matter. Those *must* name the
six hosts, because they exist to explain specific host permissions to a reviewer.
They are not public listing metadata and were never part of either rejection.

### This also applies to the images

The policy covers *"screenshots, and promotional images"*, not just the
description. Two things were fixed there even though neither was cited:

- Screenshot 1 carried a `Greenhouse · Lever · Ashby · Workday` pill.
- Screenshot 4 listed six **real employers** down its Company column — a list of
  brands in a promotional image, the same shape by a different route.

Every employer and address in the mockups is now invented, on the RFC-reserved
`.example` TLD. See the header of `scripts/make-store-assets.mjs`.

### Checklist before resubmitting

- [ ] The description names **no** ATS or job-board brands
- [ ] No image contains a list of brands, sites, or keywords
- [ ] No employer name in a mockup is a real company
- [ ] No word repeated more than five times except ordinary grammar words
- [ ] No emoji used as a section heading
- [ ] No heading followed by a bare list of anything

### Appeal, or resubmit?

Resubmit. Both rejections were correct on their face — the text really did
contain a brand list each time. An appeal argues the reviewer was wrong, which
is a slower path and not the one being asked for here.

---

## Graphics

Every file below is generated by `node scripts/make-store-assets.mjs` and lands in
`store/`. Re-run it after any wording or design change — the sizes are baked in,
so nothing can drift out of spec.

| Field in the dashboard | File | Exact size | Required? |
|---|---|---|---|
| **Store icon** | `store/store-icon-128.png` | 128×128 PNG, RGBA | **Yes** |
| **Screenshot 1** | `store/screenshot-1-fill.png` | 1280×800 PNG | **Yes** (at least one) |
| **Screenshot 2** | `store/screenshot-2-review.png` | 1280×800 PNG | Recommended |
| **Screenshot 3** | `store/screenshot-3-refuses.png` | 1280×800 PNG | Recommended |
| **Screenshot 4** | `store/screenshot-4-tracker.png` | 1280×800 PNG | Recommended |
| **Screenshot 5** | `store/screenshot-5-profile.png` | 1280×800 PNG | Recommended |
| **Small promo tile** | `store/promo-small-440x280.png` | 440×280 PNG | Strongly recommended |
| **Marquee promo tile** | `store/promo-marquee-1400x560.png` | 1400×560 PNG | Optional |

Notes that matter at review time:

- **The store icon is not the manifest icon.** The store wants 128×128 containing
  96×96 of artwork inside 16px of *transparent* padding. The manifest icons in
  `public/icons/` are full-bleed at their own sizes and are a separate thing —
  do not upload one where the other belongs.
- **Screenshots must be square-cornered and full bleed.** No rounded corners, no
  drop shadow around the image itself, no letterboxing. All five are.
- **Five is the maximum.** Order matters: the first is the one shown largest.
- **Without a small promo tile your extension ranks below ones that have it.**
- **The marquee tile is the only way to be eligible for featuring.** It is
  otherwise optional.

---

## Single purpose

```
AutoApply fills job application forms from a profile stored on the user's own
computer, and keeps a record of the applications they have filled. Every feature
serves that one purpose: the profile supplies the answers, the résumé storage
supplies the file uploads, and the tracker records the result.
```

---

## Permission justifications

One field per permission in the dashboard. Rejections are far more often about
these than about code, so each one names the user-visible feature it pays for.

**storage**
```
Stores the user's profile, résumé files and application history on their own
device using chrome.storage.local. This is the data the extension fills forms
with; none of it is transmitted anywhere.
```

**activeTab**
```
Reads the address of the tab the user is currently looking at, so the side panel
can tell them which job board they are on and whether the extension can fill that
page. Only the active tab, only while the panel is open.
```

**scripting**
```
Injects the form-filling content script into a page when the user presses "Enable
AutoApply on this site" for a careers page outside the six supported job boards.
Only in response to that explicit click.
```

**sidePanel**
```
The side panel is the extension's main interface: it shows what page you are on,
the button that fills it, and recent applications.
```

**Host permissions** — `*.greenhouse.io`, `jobs.lever.co`, `jobs.ashbyhq.com`,
`apply.workable.com`, `jobs.smartrecruiters.com`, `*.myworkdayjobs.com`
```
These six applicant tracking systems host the job application forms the extension
fills. The content script runs on them automatically so the user can open a
posting and fill it without extra steps. Greenhouse is also frequently embedded in
an iframe on a company's own careers domain, which is why all_frames is set.
```

**Optional host permissions** — `http://*/*`, `https://*/*`
```
Not requested at install, and never granted as a whole. Many employers host their
own application forms outside the six supported systems, and the extension's
generic form handling works on any standard HTML form. When the user is on such a
page they can press "Enable AutoApply on this site", which asks Chrome for access
to that one origin only. Users who never press it grant nothing.
```

---

## Data use disclosures

| Question | Answer |
|---|---|
| Personally identifiable information | **Yes** — name, address, email, phone, and the résumé the user uploads |
| Health information | No |
| Financial information | No — the extension explicitly refuses to fill bank or card fields |
| Authentication information | No — it explicitly refuses to fill password fields |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity | No |
| Website content | No |

> On "Personally identifiable information" the honest answer is **Yes**: the user
> types their own name and address into the profile. Answering No because the data
> never leaves the device is the kind of mismatch that gets a listing pulled later.
> The three certifications below are what state that it goes nowhere.

Then certify all three:

- Not being sold to third parties — **true**, nothing is transmitted at all
- Not being used or transferred for purposes unrelated to the single purpose — **true**
- Not being used or transferred to determine creditworthiness or for lending — **true**

---

## Privacy policy hosting

The dashboard requires a **public URL**. A Google Drive file works only if its
sharing is set to "Anyone with the link", and reviewers occasionally struggle with
Drive viewers — a plain web page is the safer choice.

`store/privacy-policy.html` is a standalone page with no external assets, so it can
be hosted as-is. In rough order of least effort:

1. **GitHub Pages** — commit the repo, enable Pages on the `main` branch, and the
   URL is `https://<user>.github.io/AutoApply/store/privacy-policy.html`
2. **Raw GitHub** — works if the repo is public, but renders as source rather than
   a page unless you link the rendered `PRIVACY.md` instead
3. **Any static host** — Netlify Drop, Cloudflare Pages, an S3 bucket
4. **Google Drive** — set link sharing to "Anyone with the link", same as you did
   for your previous extension

Whichever you pick, put the same URL in **both** the "Privacy policy URL" field and
the last line of the detailed description.

### The URL in use

```
https://docs.google.com/document/d/1VuqjvcuTQtC1i8NK9U5KWMwsJPoYYfwLl_L3DCAiYgo/preview
```

A Google Doc shared as "Anyone with the link". Verified readable by an
anonymous request — the full policy text comes back with no sign-in redirect
and no "Request access" prompt, which is the only thing that matters for a
reviewer opening it cold.

`/preview` rather than the `/edit?usp=sharing` form: `/edit` opens the editor
chrome and offers a "Request edit access" button, which is noise on a document
being cited as a policy. Both resolve for a public doc; `/preview` is the
read-only view.

`store/privacy-policy.html` in this repo is the same policy as a standalone
page, kept as a fallback if the Doc is ever moved or its sharing changes.

---

## Submission checklist

- [ ] Search the store for existing "AutoApply" extensions and decide on the name
- [ ] `npm test` — 240 passing
- [ ] `npm run package` — produces `releases/autoapply-1.0.0.zip`
- [ ] `node scripts/make-store-assets.mjs` — regenerates all 8 images
- [ ] Host `store/privacy-policy.html` and copy its public URL
- [ ] Paste that URL into the detailed description, replacing the placeholder
- [ ] Developer account registered (one-off $5 fee, once per account ever)
- [ ] Upload `releases/autoapply-1.0.0.zip`
- [ ] Set visibility to **Unlisted**
- [ ] Upload the store icon, 5 screenshots, and both promo tiles
- [ ] Paste every text block above
- [ ] Fill the single purpose and all six permission justifications
- [ ] Complete the data use disclosures and tick all three certifications
- [ ] Submit

Review for an unlisted item with optional broad host permissions usually takes
several days. If it is rejected, the reason is almost always a permission
justification that does not name a user-visible feature — the wording above is
written for exactly that conversation.
