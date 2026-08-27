/**
 * The profile schema.
 *
 * PROFILE_FIELDS is the single source of truth: the Options editor renders from
 * it, the match engine maps form fields onto its keys, and ProfileKey is derived
 * from it so the three can never drift apart.
 *
 * Every value is a string. Yes/no answers are the literal strings "Yes"/"No" and
 * an empty string always means "the user has not answered this" — the fill engine
 * treats empty as "skip", never as a value worth typing into a form.
 */

export const SCHEMA_VERSION = 1;

export type FieldGroup =
  | 'identity'
  | 'location'
  | 'links'
  | 'experience'
  | 'preferences'
  | 'eligibility'
  | 'voluntary'
  | 'documents';

export type FieldControl = 'text' | 'email' | 'tel' | 'url' | 'date' | 'select' | 'textarea';

export interface ProfileFieldSpec {
  key: string;
  label: string;
  group: FieldGroup;
  control: FieldControl;
  options?: readonly string[];
  placeholder?: string;
  help?: string;
}

export const GROUP_LABELS: Record<FieldGroup, string> = {
  identity: 'Identity',
  location: 'Location',
  links: 'Links',
  experience: 'Experience & education',
  preferences: 'Job preferences',
  eligibility: 'Work eligibility',
  voluntary: 'Voluntary disclosures',
  documents: 'Documents & long answers',
};

export const GROUP_ORDER: readonly FieldGroup[] = [
  'identity',
  'location',
  'links',
  'experience',
  'preferences',
  'eligibility',
  'voluntary',
  'documents',
];

const YES_NO = ['Yes', 'No'] as const;

/**
 * US EEO categories. These wordings are the ones ATS dropdowns actually use, so
 * keeping them verbatim lets the option matcher hit on an exact string compare
 * rather than fuzzy-matching a paraphrase.
 */
const VETERAN_STATUS = [
  'I am not a protected veteran',
  'I identify as one or more of the classifications of a protected veteran',
  'I do not wish to answer',
] as const;

const DISABILITY_STATUS = [
  'No, I do not have a disability and have not had one in the past',
  'Yes, I have a disability, or have had one in the past',
  'I do not want to answer',
] as const;

const RACE_ETHNICITY = [
  'American Indian or Alaska Native',
  'Asian',
  'Black or African American',
  'Hispanic or Latino',
  'Native Hawaiian or Other Pacific Islander',
  'White',
  'Two or More Races',
  'I do not wish to answer',
] as const;

const GENDER = ['Male', 'Female', 'Non-binary', 'I do not wish to answer'] as const;

const EDUCATION_LEVELS = [
  'High School',
  'Associate',
  "Bachelor's Degree",
  "Master's Degree",
  'Doctorate',
  'Other',
] as const;

const REMOTE_PREFERENCE = ['Remote', 'Hybrid', 'On-site', 'No preference'] as const;

export const PROFILE_FIELDS = [
  // ── identity ──────────────────────────────────────────────────────────────
  { key: 'firstName', label: 'First name', group: 'identity', control: 'text' },
  { key: 'lastName', label: 'Last name', group: 'identity', control: 'text' },
  {
    key: 'preferredName',
    label: 'Preferred name',
    group: 'identity',
    control: 'text',
    help: 'Only used when a form asks for it specifically.',
  },
  { key: 'email', label: 'Email', group: 'identity', control: 'email' },
  {
    key: 'phone',
    label: 'Phone',
    group: 'identity',
    control: 'tel',
    placeholder: '+1 555 123 4567',
  },

  // ── location ──────────────────────────────────────────────────────────────
  { key: 'addressLine1', label: 'Address line 1', group: 'location', control: 'text' },
  { key: 'addressLine2', label: 'Address line 2', group: 'location', control: 'text' },
  { key: 'city', label: 'City', group: 'location', control: 'text' },
  { key: 'state', label: 'State / Province', group: 'location', control: 'text' },
  { key: 'postalCode', label: 'ZIP / Postal code', group: 'location', control: 'text' },
  { key: 'country', label: 'Country', group: 'location', control: 'text' },

  // ── links ─────────────────────────────────────────────────────────────────
  {
    key: 'linkedin',
    label: 'LinkedIn',
    group: 'links',
    control: 'url',
    placeholder: 'https://linkedin.com/in/…',
  },
  {
    key: 'github',
    label: 'GitHub',
    group: 'links',
    control: 'url',
    placeholder: 'https://github.com/…',
  },
  { key: 'portfolio', label: 'Portfolio / Website', group: 'links', control: 'url' },
  { key: 'otherWebsite', label: 'Other link', group: 'links', control: 'url' },

  // ── experience ────────────────────────────────────────────────────────────
  { key: 'currentCompany', label: 'Current company', group: 'experience', control: 'text' },
  { key: 'currentTitle', label: 'Current job title', group: 'experience', control: 'text' },
  {
    key: 'yearsExperience',
    label: 'Years of experience',
    group: 'experience',
    control: 'text',
    placeholder: '5',
  },
  {
    key: 'highestEducation',
    label: 'Highest education level',
    group: 'experience',
    control: 'select',
    options: EDUCATION_LEVELS,
  },
  { key: 'school', label: 'School / University', group: 'experience', control: 'text' },
  { key: 'degree', label: 'Degree', group: 'experience', control: 'text' },
  { key: 'fieldOfStudy', label: 'Field of study', group: 'experience', control: 'text' },
  {
    key: 'graduationYear',
    label: 'Graduation year',
    group: 'experience',
    control: 'text',
    placeholder: '2021',
  },

  // ── preferences ───────────────────────────────────────────────────────────
  {
    key: 'desiredSalary',
    label: 'Desired salary',
    group: 'preferences',
    control: 'text',
    placeholder: '150000',
  },
  {
    key: 'noticePeriod',
    label: 'Notice period',
    group: 'preferences',
    control: 'text',
    placeholder: '2 weeks',
  },
  { key: 'earliestStartDate', label: 'Earliest start date', group: 'preferences', control: 'date' },
  {
    key: 'willingToRelocate',
    label: 'Willing to relocate',
    group: 'preferences',
    control: 'select',
    options: YES_NO,
  },
  {
    key: 'remotePreference',
    label: 'Work arrangement preference',
    group: 'preferences',
    control: 'select',
    options: REMOTE_PREFERENCE,
  },

  // ── eligibility ───────────────────────────────────────────────────────────
  {
    key: 'workAuthorized',
    label: 'Legally authorized to work in the country of the role',
    group: 'eligibility',
    control: 'select',
    options: YES_NO,
  },
  {
    key: 'requiresSponsorship',
    label: 'Will now or in the future require visa sponsorship',
    group: 'eligibility',
    control: 'select',
    options: YES_NO,
    help: 'Note this is the inverse of the previous question — forms ask it both ways.',
  },

  // ── voluntary ─────────────────────────────────────────────────────────────
  {
    key: 'gender',
    label: 'Gender',
    group: 'voluntary',
    control: 'select',
    options: GENDER,
  },
  { key: 'pronouns', label: 'Pronouns', group: 'voluntary', control: 'text' },
  {
    key: 'hispanicLatino',
    label: 'Hispanic or Latino',
    group: 'voluntary',
    control: 'select',
    options: YES_NO,
  },
  {
    key: 'raceEthnicity',
    label: 'Race / Ethnicity',
    group: 'voluntary',
    control: 'select',
    options: RACE_ETHNICITY,
  },
  {
    key: 'veteranStatus',
    label: 'Veteran status',
    group: 'voluntary',
    control: 'select',
    options: VETERAN_STATUS,
  },
  {
    key: 'disabilityStatus',
    label: 'Disability status',
    group: 'voluntary',
    control: 'select',
    options: DISABILITY_STATUS,
  },

  // ── documents ─────────────────────────────────────────────────────────────
  {
    key: 'howHeard',
    label: 'How did you hear about us',
    group: 'documents',
    control: 'text',
    placeholder: 'LinkedIn',
  },
  {
    key: 'coverLetter',
    label: 'Default cover letter',
    group: 'documents',
    control: 'textarea',
    help: 'Only filled into fields explicitly labelled as a cover letter.',
  },
  {
    key: 'resumeText',
    label: 'Résumé (plain text)',
    group: 'documents',
    control: 'textarea',
    help: 'Paste your résumé here for forms that ask for it as text rather than a file.',
  },
] as const satisfies readonly ProfileFieldSpec[];

export type ProfileKey = (typeof PROFILE_FIELDS)[number]['key'];

export type Profile = Record<ProfileKey, string>;

export const PROFILE_KEYS = PROFILE_FIELDS.map((f) => f.key) as ProfileKey[];

export function emptyProfile(): Profile {
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, ''])) as Profile;
}

/** Drops unknown keys and coerces everything to string, so a stale or hand-edited
 *  storage blob can never inject junk into the fill pipeline. */
export function normalizeProfile(raw: unknown): Profile {
  const profile = emptyProfile();
  if (!raw || typeof raw !== 'object') return profile;
  const source = raw as Record<string, unknown>;
  for (const key of PROFILE_KEYS) {
    const value = source[key];
    if (typeof value === 'string') profile[key] = value;
    else if (typeof value === 'number' || typeof value === 'boolean') profile[key] = String(value);
  }
  return profile;
}

export function fieldSpec(key: ProfileKey): ProfileFieldSpec {
  const spec = PROFILE_FIELDS.find((f) => f.key === key);
  if (!spec) throw new Error(`Unknown profile key: ${key}`);
  return spec;
}

/** How many fields the user has actually filled in — drives the "profile is
 *  incomplete" nudge in the sidepanel. */
export function filledCount(profile: Profile): number {
  return PROFILE_KEYS.filter((k) => profile[k].trim() !== '').length;
}

/**
 * Below this a profile cannot answer most of an ordinary application, and both
 * the side panel and the profile editor say so. Roughly the identity, contact
 * and address fields — the ones every form asks for before anything else.
 */
export const USABLE_FIELD_COUNT = 12;
