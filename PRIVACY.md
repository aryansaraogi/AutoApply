# AutoApply — Privacy Policy

**Last updated: 5 August 2026**  ·  Applies to AutoApply version 1.0.0

## The short version

AutoApply does not send your data anywhere. There is no server, no account, no
analytics, and no telemetry. Everything it stores stays in your own browser on
your own computer.

The extension makes **no network requests of any kind**. It has no code that can
make one — no `fetch`, no `XMLHttpRequest`, no third-party libraries.

## What is stored

All of it lives in `chrome.storage.local`, Chrome's per-device extension storage,
on the machine where you installed the extension.

| Data | What it is | Why |
|---|---|---|
| Profile | Name, email, phone, address, links, current job, education, salary and start-date preferences, work eligibility answers, and voluntary equal-opportunity answers (gender, race/ethnicity, veteran and disability status) — all entered by you | Filling application forms |
| Résumés | The `.pdf` / `.docx` / `.doc` / `.rtf` / `.txt` files you upload | Attaching to résumé uploads on application forms |
| Application history | Company, job title, page URL, date, pipeline stage, your notes, and how many fields were filled | The job tracker |
| Settings | Two on/off preferences | Remembering your choices |

The equal-opportunity answers are sensitive by nature. They are stored only
because US application forms routinely ask for them, they are entirely optional,
and they never leave your device.

## What is never collected

- No browsing history. The extension only reads a page when you ask it to fill one.
- No keystrokes, no page contents, no screenshots.
- No analytics, crash reports, usage statistics, or identifiers of any kind.
- Nothing is sold, shared, or transferred to anyone, because nothing is transmitted.

## What AutoApply deliberately will not touch

Beyond privacy, these are hard rules in the code:

- It never submits a form. You review and submit yourself.
- It never fills passwords, national insurance or social security numbers, bank or
  card details, passport or driving licence numbers, or dates of birth.
- It never ticks a checkbox, since almost every one is a consent or acknowledgement.
- It only attaches a résumé, and only to a field whose label asks for one.

## Permissions

| Permission | What it is for |
|---|---|
| `storage` | Saving the data above on your device |
| `activeTab` | Reading the current tab's address, to tell you which job board you are on |
| `scripting` | Starting the form filler on a site you explicitly enable it for |
| `sidePanel` | Drawing the extension's panel |
| Access to six job boards | Greenhouse, Lever, Ashby, Workable, SmartRecruiters and Workday — the sites it works on automatically |
| Optional access to other sites | Never requested when you install. Granted one site at a time, only when you press "Enable AutoApply on this site" on a careers page outside those six. |

## Deleting your data

- **Profile** — "Clear profile" on the profile page
- **A résumé** — "Remove" next to it on the profile page
- **An application** — "Delete" on that row in the tracker
- **Everything** — remove the extension from `chrome://extensions`; Chrome deletes
  its storage with it

None of this requires contacting anyone, because nobody else has a copy.

## Changes

Any future version that transmits data would require a new permission, which Chrome
shows you before it installs. This policy would be updated in the same release, and
the date at the top would change.

## Contact

Questions or problems: open an issue at
<https://github.com/aryansaraogi/AutoApply/issues>.
