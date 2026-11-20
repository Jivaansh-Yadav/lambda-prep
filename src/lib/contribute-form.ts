import { isTrustedDriveLink } from '@/lib/upload-policy';

/** Which half of step 2 the contributor chose. */
export type ContributionMethod = 'upload' | 'link';

/** Everything the form knows at submit time, in the shape validation wants. */
export interface ContributionDraft {
  fileName: string;
  classSlug: string;
  /** Already resolved: the typed "Other" subject when that option is picked. */
  subject: string;
  method: ContributionMethod;
  hasFile: boolean;
  driveLink: string;
  contactMethod: string;
}

/** The required inputs, in the order they appear on the page. */
export const CONTRIBUTION_FIELD_ORDER = [
  'fileName',
  'classSlug',
  'subject',
  'file',
  'driveLink',
  'contactMethod',
] as const;

export type ContributionField = (typeof CONTRIBUTION_FIELD_ORDER)[number];

export type ContributionErrors = Partial<Record<ContributionField, string>>;

export const CONTRIBUTION_FIELD_LABELS: Record<ContributionField, string> = {
  fileName: 'File name',
  classSlug: 'Class',
  subject: 'Subject',
  file: 'File to upload',
  driveLink: 'Drive link',
  contactMethod: 'Contact method',
};

/**
 * Field-level messages for a submission attempt.
 *
 * Validation lives here rather than inside the route so the rules can be
 * tested without a DOM, and so the submit button never has to be silently
 * disabled: the form stays submittable, and the attempt explains what is
 * missing (GH #15). The Drive-link rule is the same one `contribute-server.ts`
 * enforces — this is the friendly half, the server still checks.
 */
export function validateContribution(draft: ContributionDraft): ContributionErrors {
  const errors: ContributionErrors = {};

  if (!draft.fileName.trim()) errors.fileName = 'Add a name for this resource.';
  if (!draft.classSlug.trim()) errors.classSlug = 'Choose the class this is for.';
  if (!draft.subject.trim()) errors.subject = 'Choose a subject, or type one under Other.';

  if (draft.method === 'upload') {
    if (!draft.hasFile) errors.file = 'Choose a file to upload, or switch to a Drive link.';
  } else {
    const link = draft.driveLink.trim();
    if (!link) {
      errors.driveLink = 'Paste the shareable Drive link.';
    } else if (!isTrustedDriveLink(link)) {
      errors.driveLink = 'Use an https link from drive.google.com or docs.google.com.';
    }
  }

  if (!draft.contactMethod.trim()) {
    errors.contactMethod = 'Tell us how to reach you about this submission.';
  }

  return errors;
}

/** Missing fields in page order — used for the summary next to Submit. */
export function missingFields(errors: ContributionErrors): ContributionField[] {
  return CONTRIBUTION_FIELD_ORDER.filter((field) => errors[field]);
}
