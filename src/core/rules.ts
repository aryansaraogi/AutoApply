/**
 * The field dictionary.
 *
 * Patterns are tested against *canonicalized* text (see normalize.ts): lowercase,
 * punctuation collapsed to single spaces, spelling variants folded. So a rule can
 * be written as /\bfirst name\b/ and still match "First Name:", "Given name*",
 * and "FORENAME".
 *
 * Exclusions matter as much as patterns. "Previous employer" must not fill with
 * your current company, and "Are you authorized to work?" must not be confused
 * with "Do you require sponsorship?" — those two appear on the same form and
 * mean opposite things.
 */

import type { Profile } from '@/storage/schema';
import type { ControlKind, ValueKey } from './types';
import { CHOICE_KINDS, TEXTUAL_KINDS } from './types';

export interface MatchRule {
  key: ValueKey;
  /** WHATWG autocomplete tokens that unambiguously identify this field. */
  autocomplete?: readonly string[];
  /** Tested against the canonicalized label (which includes any group legend). */
  label?: readonly RegExp[];
  /** Tested against the canonicalized name and id attributes. */
  attr?: readonly RegExp[];
  /** Restricts the rule to these control kinds. */
  kinds?: readonly ControlKind[];
  /** If any of these hit the label or attributes, the rule is disqualified. */
  exclude?: readonly RegExp[];
  /** Tie-breaker for near-equal scores. Higher means more specific. */
  weight?: number;
}

/**
 * Never autofilled, whatever the rules say. These are either sensitive enough
 * that silently populating them would be wrong, or things we simply do not store.
 */
export const BLOCKED_PATTERNS: readonly RegExp[] = [
  /\bpassword\b/,
  /\bsocial security\b|\bssn\b/,
  /\bnational insurance\b|\bnino\b/,
  /\btax id\b|\bein\b/,
  /\bcredit card\b|\bcard number\b|\bcvv\b|\bcvc\b/,
  /\bbank\b|\brouting\b|\biban\b|\bsort code\b|\baccount number\b/,
  /\bdriver.?s? licen[cs]e\b/,
  /\bpassport\b/,
  /\bdate of birth\b|\bbirth date\b|\bdob\b/,
  /\bcaptcha\b/,
  /\bsecurity question\b|\bsecurity answer\b/,
];

/**
 * Questions that look answerable but are compound, where picking either profile
 * answer could put a false statement on someone's application. We surface these
 * for the user to answer rather than guessing.
 *
 * The canonical example is "Are you legally authorized to work in the US without
 * sponsorship?" — a single yes/no that folds together `workAuthorized` and
 * `requiresSponsorship`, which can disagree.
 */
export const MANUAL_REVIEW_PATTERNS: readonly {
  pattern: RegExp;
  reason: string;
}[] = [
  {
    pattern: /authoriz\w*\s+to\s+work\b[^.]*\bwithout\b[^.]*\bsponsor/,
    reason:
      'This asks about authorization and sponsorship in one question — answer it yourself.',
  },
  {
    pattern: /\bnow\s+or\s+in\s+the\s+future\b[^.]*\bauthoriz/,
    reason:
      'Combines present and future work authorization — answer it yourself.',
  },
];

const CHOICE_OR_TEXT: readonly ControlKind[] = [...CHOICE_KINDS, ...TEXTUAL_KINDS];
const LONG_FORM: readonly ControlKind[] = ['textarea', 'contenteditable'];

export const RULES: readonly MatchRule[] = [
  // ── names ────────────────────────────────────────────────────────────────
  {
    key: 'firstName',
    autocomplete: ['given-name'],
    label: [/\bfirst name\b/, /\bfirst\b(?!\s+(day|line|choice))/],
    attr: [/\bfirst name\b/, /\bfname\b/],
    exclude: [/\blast\b/, /\bmiddle\b/, /\bday\b/, /\bpreferred\b/],
    weight: 12,
  },
  {
    key: 'lastName',
    autocomplete: ['family-name'],
    label: [/\blast name\b/, /\blast\b(?!\s+(day|employer|position|company))/],
    attr: [/\blast name\b/, /\blname\b/, /\bsurname\b/],
    exclude: [/\bfirst\b/, /\bmiddle\b/, /\bemployer\b/, /\bcompany\b/],
    weight: 12,
  },
  {
    key: 'preferredName',
    label: [/\bpreferred (first )?name\b/, /\bnickname\b/, /\bgoes by\b/],
    attr: [/\bpreferred name\b/, /\bnickname\b/],
    weight: 16,
  },
  {
    key: 'fullName',
    autocomplete: ['name'],
    label: [/\bfull name\b/, /^name$/, /\byour name\b/, /\bcandidate name\b/],
    attr: [/^name$/, /\bfull name\b/],
    exclude: [
      /\bfirst\b/,
      /\blast\b/,
      /\bmiddle\b/,
      /\bpreferred\b/,
      /\buser\b/,
      /\bfile\b/,
      /\bcompany\b/,
      /\bschool\b/,
      /\breference\b/,
      /\bemergency\b/,
      /\bmanager\b/,
    ],
    weight: 8,
  },

  // ── contact ──────────────────────────────────────────────────────────────
  {
    key: 'email',
    autocomplete: ['email'],
    label: [/\bemail\b/],
    attr: [/\bemail\b/],
    weight: 14,
  },
  {
    key: 'phone',
    autocomplete: ['tel', 'tel-national'],
    // canonicalize() already folds mobile / cell / telephone onto "phone".
    label: [/\bphone\b/],
    attr: [/\bphone\b/, /\btel\b/],
    exclude: [/\bextension\b/, /\bext\b/, /\bcountry code\b/, /\btype\b/],
    weight: 14,
  },

  // ── address ──────────────────────────────────────────────────────────────
  {
    key: 'addressLine1',
    autocomplete: ['address-line1', 'street-address'],
    label: [/\baddress line 1\b/, /\bstreet address\b/, /^address$/, /\bstreet\b/],
    attr: [/\baddress line 1\b/, /\bstreet\b/, /^address$/],
    exclude: [/\bemail\b/, /\bline 2\b/, /\bcity\b/, /\bstate\b/, /\bcountry\b/, /\bzip\b/, /\bip\b/],
    weight: 10,
  },
  {
    key: 'addressLine2',
    autocomplete: ['address-line2'],
    label: [/\baddress line 2\b/, /\bapt\b/, /\bapartment\b/, /\bsuite\b/, /\bunit\b/],
    attr: [/\baddress line 2\b/, /\baddress2\b/],
    weight: 14,
  },
  {
    key: 'city',
    autocomplete: ['address-level2'],
    label: [/\bcity\b/, /\btown\b/, /\blocality\b/],
    attr: [/\bcity\b/, /\btown\b/],
    weight: 14,
  },
  {
    key: 'state',
    autocomplete: ['address-level1'],
    label: [/\bstate\b/, /\bprovince\b/, /\bregion\b/, /\bcounty\b/],
    attr: [/\bstate\b/, /\bprovince\b/, /\bregion\b/],
    exclude: [/\bstatus\b/, /\bstatement\b/, /\bunited\b/],
    weight: 12,
  },
  {
    key: 'postalCode',
    autocomplete: ['postal-code'],
    // canonicalize() folds "zip code" → "zip" and "postal code" → "postcode".
    label: [/\bzip\b/, /\bpostcode\b/, /\bpostal\b/],
    attr: [/\bzip\b/, /\bpostcode\b/, /\bpostal\b/],
    weight: 14,
  },
  {
    key: 'country',
    autocomplete: ['country', 'country-name'],
    label: [/\bcountry\b/],
    attr: [/\bcountry\b/],
    exclude: [/\bcode\b/],
    weight: 12,
  },

  // ── links ────────────────────────────────────────────────────────────────
  {
    key: 'linkedin',
    label: [/\blinkedin\b/],
    attr: [/\blinkedin\b/],
    weight: 20,
  },
  {
    key: 'github',
    label: [/\bgithub\b/],
    attr: [/\bgithub\b/],
    weight: 20,
  },
  {
    key: 'portfolio',
    autocomplete: ['url'],
    label: [/\bportfolio\b/, /\bpersonal (website|site|url)\b/, /\bwebsite\b/, /\bblog\b/],
    attr: [/\bportfolio\b/, /\bwebsite\b/],
    exclude: [/\bcompany\b/, /\bemployer\b/, /\bschool\b/, /\bother\b/],
    weight: 10,
  },
  {
    key: 'otherWebsite',
    label: [/\bother (website|link|url)\b/, /\badditional (website|link|url)\b/],
    weight: 16,
  },

  // ── experience ───────────────────────────────────────────────────────────
  {
    key: 'currentCompany',
    autocomplete: ['organization'],
    label: [/\bcurrent (company|employer)\b/, /\bcompany\b/, /\bemployer\b/, /\borganization\b/],
    attr: [/\bcompany\b/, /\bemployer\b/, /\borganization\b/],
    exclude: [
      /\bprevious\b/,
      /\bformer\b/,
      /\bprior\b/,
      /\bwhy\b/,
      /\breason\b/,
      /\bschool\b/,
      /\buniversity\b/,
      /\bwebsite\b/,
      /\bsize\b/,
      /\bour\b/,
      /\bthis\b/,
    ],
    weight: 8,
  },
  {
    key: 'currentTitle',
    autocomplete: ['organization-title'],
    label: [/\bcurrent (job )?(title|role|position)\b/, /\bjob title\b/, /\btitle\b/],
    attr: [/\bjob title\b/, /\btitle\b/, /\bposition\b/],
    exclude: [
      /\bdesired\b/,
      /\bpreferred\b/,
      /\bapplying\b/,
      /\bprevious\b/,
      /\bthis (role|position)\b/,
      /\bmr\b/,
      /\bsalutation\b/,
    ],
    weight: 8,
  },
  {
    key: 'yearsExperience',
    label: [
      /\byears? of (relevant |professional |total )?experience\b/,
      /\byears experience\b/,
      /\bhow many years\b/,
    ],
    attr: [/\byears experience\b/, /\byears of experience\b/],
    weight: 18,
  },

  // ── education ────────────────────────────────────────────────────────────
  {
    key: 'highestEducation',
    label: [/\bhighest (level of )?education\b/, /\beducation level\b/, /\bdegree level\b/],
    kinds: CHOICE_OR_TEXT,
    weight: 20,
  },
  {
    key: 'school',
    label: [/\bschool\b/, /\buniversity\b/, /\bcollege\b/, /\binstitution\b/, /\balma mater\b/],
    attr: [/\bschool\b/, /\buniversity\b/, /\bcollege\b/],
    weight: 14,
  },
  {
    key: 'degree',
    label: [/\bdegree\b/],
    attr: [/\bdegree\b/],
    exclude: [/\blevel\b/, /\bhighest\b/],
    weight: 10,
  },
  {
    key: 'fieldOfStudy',
    label: [/\bfield of study\b/, /\bmajor\b/, /\bdiscipline\b/, /\bconcentration\b/],
    attr: [/\bfield of study\b/, /\bmajor\b/, /\bdiscipline\b/],
    weight: 16,
  },
  {
    key: 'graduationYear',
    label: [/\bgraduation (year|date)\b/, /\byear of graduation\b/, /\bexpected graduation\b/],
    attr: [/\bgraduation\b/],
    weight: 18,
  },

  // ── preferences ──────────────────────────────────────────────────────────
  {
    key: 'desiredSalary',
    label: [
      /\b(desired|expected|target|requested) (salary|compensation|pay|rate)\b/,
      /\bsalary (expectation|requirement|range)\b/,
      /\bcompensation expectation\b/,
      /\bsalary\b/,
    ],
    attr: [/\bsalary\b/, /\bcompensation\b/],
    exclude: [/\bcurrent\b/],
    weight: 12,
  },
  {
    key: 'noticePeriod',
    label: [/\bnotice period\b/, /\bhow much notice\b/, /\bnotice\b/],
    attr: [/\bnotice\b/],
    weight: 16,
  },
  {
    key: 'earliestStartDate',
    label: [
      /\b(earliest )?(available )?start date\b/,
      /\bwhen can you start\b/,
      /\bavailability date\b/,
      /\bavailable to start\b/,
      /\bfirst day\b/,
    ],
    attr: [/\bstart date\b/, /\bavailable\b/],
    weight: 16,
  },
  {
    key: 'willingToRelocate',
    label: [/\brelocat/, /\bwilling to move\b/],
    attr: [/\brelocat/],
    weight: 18,
  },
  {
    key: 'remotePreference',
    label: [/\bwork (arrangement|preference|location preference)\b/, /\bremote\b/, /\bhybrid\b/],
    attr: [/\bwork arrangement\b/, /\bremote\b/],
    weight: 10,
  },

  // ── eligibility ──────────────────────────────────────────────────────────
  {
    key: 'workAuthorized',
    label: [/\b(legally )?authoriz\w* to work\b/, /\bwork authoriz/, /\beligible to work\b/],
    attr: [/\bwork authoriz/, /\bauthorized\b/],
    // Sponsorship is a different question with a different answer — see
    // MANUAL_REVIEW_PATTERNS for the compound phrasing that folds them together.
    exclude: [/\bsponsor/],
    weight: 18,
  },
  {
    key: 'requiresSponsorship',
    label: [
      /\b(require|need)\w*\s+(visa\s+|immigration\s+)?sponsor/,
      /\bsponsorship (now|in the future|required|needed)\b/,
      /\bvisa sponsorship\b/,
      /\bsponsor/,
    ],
    attr: [/\bsponsor/],
    weight: 18,
  },

  // ── voluntary disclosures ────────────────────────────────────────────────
  {
    key: 'hispanicLatino',
    label: [/\bhispanic\b/, /\blatino\b/, /\blatinx\b/],
    attr: [/\bhispanic\b/, /\blatino\b/],
    weight: 22,
  },
  {
    key: 'raceEthnicity',
    label: [/\brace\b/, /\bethnicity\b/, /\bethnic\b/],
    attr: [/\brace\b/, /\bethnicity\b/],
    exclude: [/\bhispanic\b/, /\blatino\b/],
    weight: 16,
  },
  {
    key: 'gender',
    label: [/\bgender\b/, /\bsex\b/],
    attr: [/\bgender\b/],
    exclude: [/\bpronoun\b/, /\bidentity statement\b/],
    weight: 16,
  },
  {
    key: 'pronouns',
    label: [/\bpronouns?\b/],
    attr: [/\bpronoun\b/],
    weight: 22,
  },
  {
    key: 'veteranStatus',
    label: [/\bveteran\b/, /\bmilitary service\b/, /\barmed forces\b/],
    attr: [/\bveteran\b/, /\bmilitary\b/],
    weight: 20,
  },
  {
    key: 'disabilityStatus',
    label: [/\bdisabilit/, /\bdisabled\b/],
    attr: [/\bdisabilit/],
    weight: 20,
  },

  // ── long answers ─────────────────────────────────────────────────────────
  {
    key: 'howHeard',
    label: [
      /\bhow did you (hear|find|learn)\b/,
      /\bhow you heard\b/,
      /\breferral source\b/,
      /\bwhere did you (hear|find)\b/,
      /\bsource\b/,
    ],
    attr: [/\bhow did you hear\b/, /\bsource\b/],
    exclude: [/\bopen source\b/],
    weight: 16,
  },
  {
    key: 'coverLetter',
    // Only an explicit "cover letter" field. Company-specific prompts ("Why do
    // you want to work here?") are deliberately left unmatched: a stored generic
    // answer pasted into one reads worse than a blank box, and the profile
    // editor promises this value is only used where the label asks for it.
    label: [/\bcover letter\b/],
    attr: [/\bcover letter\b/],
    kinds: LONG_FORM,
    weight: 20,
  },
  {
    key: 'resumeText',
    label: [/\bresume\b/, /\bpaste your resume\b/],
    attr: [/\bresume\b/],
    // Only ever the paste-a-résumé textarea. File uploads are out of scope.
    kinds: LONG_FORM,
    weight: 18,
  },
];

/**
 * Reads a value for a key, composing the ones that are not stored directly.
 * Returns an empty string when the profile cannot answer.
 */
export function resolveValue(profile: Profile, key: ValueKey): string {
  if (key === 'fullName') {
    return [profile.firstName, profile.lastName].map((p) => p.trim()).filter(Boolean).join(' ');
  }
  return profile[key] ?? '';
}
