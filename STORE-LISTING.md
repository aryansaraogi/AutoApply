# Chrome Web Store listing — AutoApply 1.0.0

Everything the Developer Dashboard asks for, kept here so it is version-controlled
and identical between submissions. Copy each block into the matching field.

**Visibility: Unlisted.** Not discoverable in search; installable only by link.

---

## Item details

**Name**
```
AutoApply — job application autofill
```

> ⚠️ "AutoApply" is a crowded name in the job-search space. Store names need not
> be unique so this will not block submission, but search for conflicts before
> building an identity on it — a trademark complaint after publishing is far more
> annoying than renaming now.

**Short description** (132 characters max — this is 129)
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
• Tracks each application through Draft, Applied, Screening, Interview, Offer,
  Rejected or Withdrawn, with notes and CSV export.

WORKS AUTOMATICALLY ON

Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Workday. On any other
careers page you can turn it on for that site with one click and it will use its
generic form handling.

WHAT IT WILL NOT DO

• Never submits a form.
• Never fills passwords, social security or national insurance numbers, bank or
  card details, passport or licence numbers, or dates of birth.
• Never ticks a checkbox — almost every one is a consent or acknowledgement, and
  those are yours to agree to.
• Never answers a question it is not confident about. "Are you legally authorized
  to work in the US without sponsorship?" combines two answers that can disagree,
  so it hands that one back to you rather than guessing.
• Only ever attaches a résumé, and only to a field whose label asks for one.
  Cover letters, transcripts and portfolios are left alone.

YOUR DATA STAYS WITH YOU

There is no account, no server, and no analytics. The extension makes no network
requests at all — there is no code in it that can. Everything is stored in your
browser on your machine, and removing the extension removes it.

Privacy policy: https://github.com/aryansaraogi/AutoApply/blob/main/PRIVACY.md
Source code: https://github.com/aryansaraogi/AutoApply
```

**Privacy policy URL**
```
https://github.com/aryansaraogi/AutoApply/blob/main/PRIVACY.md
```

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

One field per permission in the dashboard.

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

Then certify all three:

- Not being sold to third parties — **true**, nothing is transmitted at all
- Not being used or transferred for purposes unrelated to the single purpose — **true**
- Not being used or transferred to determine creditworthiness or for lending — **true**

---

## Screenshots

1280×800, produced by `npm run screenshots`.

| File | Shows |
|---|---|
| `store/screenshot-1-fill.png` | A filled application with the review panel listing what still needs the user |
| `store/screenshot-2-tracker.png` | The job tracker with stages and filters |
| `store/screenshot-3-profile.png` | The profile page and résumé manager |

---

## Submission checklist

- [ ] `npm test` — 200 passing
- [ ] `npm run package` — produces `releases/autoapply-1.0.0.zip`
- [ ] `PRIVACY.md` pushed to `main` so the policy URL resolves publicly
- [ ] Developer account registered (one-off $5 fee)
- [ ] Upload zip, set visibility to **Unlisted**
- [ ] Paste every block above
- [ ] Submit

Review for an unlisted item with optional broad host permissions usually takes
several days. Rejections are typically about permission justifications rather than
code — the wording above is written for exactly that conversation.
