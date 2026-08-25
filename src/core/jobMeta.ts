/**
 * Works out which job a page is, to label tracker entries.
 *
 * Careers pages are hostile to this. The `h1` is as likely to be a marketing
 * line ("Begin your 10x journey with Acme!") or a bare verb ("Apply") as a job
 * title, and URL path segments are full of routing noise — Greenhouse embeds
 * live at `/embed/job_app`, so the first segment is the word "embed".
 *
 * So every candidate is validated rather than taken on position, and anything
 * that fails validation is dropped in favour of the next source. Getting it
 * wrong is cheap — the tracker lets the user edit both fields — but a row
 * labelled "Apply" at "careers.cisco.com" is useless, and blank is more honest.
 */

export interface JobMeta {
  company: string;
  role: string;
}

/** Longest plausible job title. Anything longer is prose. */
const MAX_ROLE = 120;
const MAX_COMPANY = 60;

/**
 * Words that appear where a company name should be but name a route, not an
 * employer. Drawn from real URLs: Greenhouse embeds, "join us" landing pages,
 * locale prefixes.
 */
const JUNK_SEGMENTS = new Set([
  'embed',
  'embedded',
  'joinus',
  'join-us',
  'join',
  'careers',
  'career',
  'jobs',
  'job',
  'apply',
  'application',
  'applications',
  'job_app',
  'jobapp',
  'openings',
  'opening',
  'positions',
  'position',
  'roles',
  'vacancies',
  'search',
  'listing',
  'listings',
  'index',
  'home',
  'main',
  'www',
  'boards',
  'board',
  'hire',
  'hiring',
  'talent',
  'recruiting',
  'recruitment',
  'people',
  'work',
  'en',
  'en-us',
  'en-gb',
  'us',
  'uk',
  'global',
]);

/** Headings that are page furniture rather than a job title. */
const JUNK_ROLE =
  /^(apply|apply now|application|applications|apply for this job|careers?|jobs?|join us|join our team|open (positions|roles|jobs)|current openings|we are hiring|we're hiring|home|overview|submit|submit application|let'?s get started|get started)$/i;

export function extractJobMeta(
  doc: Document = document,
  location: Location = doc.location,
): JobMeta {
  const structured = fromJsonLd(doc);

  const role =
    structured.role ||
    fromTitlePattern(doc).role ||
    fromHeading(doc) ||
    fromTitleTail(doc) ||
    '';

  const company =
    structured.company ||
    cleanCompany(meta(doc, 'meta[property="og:site_name"]')) ||
    fromTitlePattern(doc).company ||
    cleanCompany(meta(doc, 'meta[name="application-name"]')) ||
    companyFromUrl(location) ||
    '';

  return { role: role.slice(0, MAX_ROLE), company: company.slice(0, MAX_COMPANY) };
}

// ── sources ─────────────────────────────────────────────────────────────────

/**
 * schema.org JobPosting, which most applicant tracking systems emit. When it is
 * there it is authoritative — it is the employer stating the title and their own
 * name, rather than us guessing from layout.
 */
function fromJsonLd(doc: Document): Partial<JobMeta> {
  for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(node.textContent ?? '');
    } catch {
      continue; // one malformed block must not stop us finding a later good one
    }

    for (const entry of flatten(parsed)) {
      if (!isObject(entry)) continue;
      const type = entry['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (!types.includes('JobPosting')) continue;

      const role = typeof entry.title === 'string' ? entry.title.trim() : '';
      const org = entry.hiringOrganization;
      const company =
        isObject(org) && typeof org.name === 'string'
          ? org.name.trim()
          : typeof org === 'string'
            ? org.trim()
            : '';

      if (role || company) {
        return { role: isJunkRole(role) ? '' : role, company: cleanCompany(company) };
      }
    }
  }
  return {};
}

/**
 * Splits titles that name both parts. "Job Application for X at Y" is the exact
 * shape Greenhouse and Lever use, and it is the only pattern precise enough to
 * trust for the company as well as the role.
 */
export function splitRoleAndCompany(text: string): Partial<JobMeta> {
  const value = text.trim();
  if (!value) return {};

  const application = /^job application for\s+(.+?)\s+at\s+(.+)$/i.exec(value);
  if (application) {
    return { role: application[1]?.trim(), company: cleanCompany(application[2] ?? '') };
  }

  const at = /^(.+?)\s+at\s+(.+)$/i.exec(value);
  if (at && (at[1]?.length ?? 0) > 2) {
    return { role: at[1]?.trim(), company: cleanCompany(at[2] ?? '') };
  }

  return {};
}

function fromTitlePattern(doc: Document): Partial<JobMeta> {
  for (const text of [meta(doc, 'meta[property="og:title"]'), doc.title]) {
    const split = splitRoleAndCompany(stripBoardSuffix(text));
    if (split.role && !isJunkRole(split.role)) return split;
  }
  return {};
}

/** The first heading that reads like a job title rather than a slogan. */
function fromHeading(doc: Document): string {
  for (const node of doc.querySelectorAll('h1, h2')) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text && !isJunkRole(text)) return text;
  }
  return '';
}

/** Page titles are usually "Role - Company | Board"; keep the leading part. */
function fromTitleTail(doc: Document): string {
  const head = stripBoardSuffix(doc.title).split(/\s+[|–—·]\s+|\s+-\s+/)[0]?.trim() ?? '';
  return head && !isJunkRole(head) ? head : '';
}

// ── validation ──────────────────────────────────────────────────────────────

/**
 * A heading is rejected as a role when it is page furniture, an exclamation
 * (marketing copy essentially always is), or long enough to be a sentence.
 */
export function isJunkRole(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > MAX_ROLE) return true;
  if (JUNK_ROLE.test(value)) return true;
  if (value.includes('!')) return true;
  return false;
}

/** Drops routing words and tidies a slug into something presentable. */
export function cleanCompany(text: string): string {
  const value = text.trim().replace(/\s+/g, ' ');
  if (!value || value.length > MAX_COMPANY) return '';
  if (JUNK_SEGMENTS.has(value.toLowerCase().replace(/[\s_]+/g, '-'))) return '';
  return value;
}

// ── url fallback ────────────────────────────────────────────────────────────

/**
 * Last resort. "jobs.lever.co/acme/…" names the employer in the path;
 * "careers.cisco.com" names it in the host, behind a subdomain that does not.
 */
function companyFromUrl(location: Location): string {
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return ''; // opaque origin in a sandboxed frame
  }

  const segment = url.pathname
    .split('/')
    .filter(Boolean)
    .map(decodeSegment)
    .find((part) => part && !JUNK_SEGMENTS.has(part.toLowerCase()) && !looksLikeId(part));
  if (segment) return titleCase(segment);

  // Walk in from the left so careers.cisco.com yields Cisco, not Careers, and
  // stop before the public suffix so we never return "Com" or "Co".
  const labels = url.hostname.split('.');
  const meaningful = labels
    .slice(0, Math.max(1, labels.length - 1))
    .find((label) => !JUNK_SEGMENTS.has(label.toLowerCase()));

  return meaningful ? titleCase(meaningful) : '';
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Ids, tokens and locale codes are never a company name. */
function looksLikeId(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8,}$/i.test(segment)) return true;
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(segment)) return true;
  if (/\d{4,}/.test(segment)) return true;
  return false;
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_+]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Removes the job-board name most titles end with. */
function stripBoardSuffix(title: string): string {
  return title
    .replace(
      /\s*[|–—·-]\s*(greenhouse|lever|ashby|workable|smartrecruiters|workday|jobs?|careers?)\s*$/i,
      '',
    )
    .trim();
}

function meta(doc: Document, selector: string): string {
  return doc.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? '';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JSON-LD arrives as an object, an array, or an @graph wrapper. */
function flatten(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (isObject(value) && Array.isArray(value['@graph'])) {
    return [value, ...value['@graph'].flatMap(flatten)];
  }
  return [value];
}
