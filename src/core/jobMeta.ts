/**
 * Best-effort "what job is this?" extraction, used to label history entries.
 *
 * Generic heuristics only — site adapters override these with selectors that
 * actually know where the ATS puts the company and role.
 */

export interface JobMeta {
  company: string;
  role: string;
}

export function extractJobMeta(
  doc: Document = document,
  location: Location = doc.location,
): JobMeta {
  return { company: extractCompany(doc, location), role: extractRole(doc) };
}

function extractCompany(doc: Document, location: Location): string {
  const candidates = [
    meta(doc, 'meta[property="og:site_name"]'),
    meta(doc, 'meta[name="application-name"]'),
    attr(doc, '[data-company]', 'data-company'),
  ];
  const found = candidates.find((value) => value && value.length <= 80);
  if (found) return found;

  // "jobs.lever.co/acme/…" and "acme.greenhouse.io" both name the company in
  // the URL when nothing else does.
  return companyFromUrl(location) ?? '';
}

function extractRole(doc: Document): string {
  const heading = doc.querySelector('h1')?.textContent?.trim();
  if (heading && heading.length <= 140) return heading;

  const ogTitle = meta(doc, 'meta[property="og:title"]');
  if (ogTitle) return trimTitle(ogTitle);

  return trimTitle(doc.title);
}

/** Page titles are usually "Role - Company | Board"; keep the leading part. */
function trimTitle(title: string): string {
  const head = title.split(/\s+[|–—·]\s+|\s+-\s+/)[0]?.trim() ?? '';
  return head.length > 0 && head.length <= 140 ? head : title.slice(0, 140);
}

function meta(doc: Document, selector: string): string {
  const node = doc.querySelector<HTMLMetaElement>(selector);
  return node?.content?.trim() ?? '';
}

function attr(doc: Document, selector: string, name: string): string {
  return doc.querySelector(selector)?.getAttribute(name)?.trim() ?? '';
}

function companyFromUrl(location: Location): string | null {
  try {
    const url = new URL(location.href);
    const [firstSegment] = url.pathname.split('/').filter(Boolean);

    if (/(^|\.)lever\.co$/.test(url.hostname) && firstSegment) return titleCase(firstSegment);
    if (/(^|\.)ashbyhq\.com$/.test(url.hostname) && firstSegment) return titleCase(firstSegment);
    if (/(^|\.)workable\.com$/.test(url.hostname) && firstSegment) return titleCase(firstSegment);

    const subdomain = url.hostname.split('.')[0];
    if (subdomain && !['www', 'jobs', 'boards', 'apply', 'careers'].includes(subdomain)) {
      return titleCase(subdomain);
    }
  } catch {
    /* location may be opaque in a sandboxed frame */
  }
  return null;
}

function titleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
