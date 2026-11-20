import { describe, expect, it } from 'vitest';
import {
  CONTRIBUTION_FIELD_ORDER,
  missingFields,
  validateContribution,
  type ContributionDraft,
} from '@/lib/contribute-form';

const valid: ContributionDraft = {
  fileName: 'Chemical Bonding — Revision Notes.pdf',
  classSlug: 'icse-10',
  subject: 'Chemistry',
  method: 'upload',
  hasFile: true,
  driveLink: '',
  contactMethod: 'discord: student#1234',
};

describe('validateContribution', () => {
  it('accepts a complete upload', () => {
    expect(validateContribution(valid)).toEqual({});
  });

  it('accepts a complete Drive-link submission', () => {
    expect(
      validateContribution({
        ...valid,
        method: 'link',
        hasFile: false,
        driveLink: 'https://drive.google.com/file/d/abc123/view?usp=sharing',
      }),
    ).toEqual({});
  });

  it('names every empty required field', () => {
    const errors = validateContribution({
      ...valid,
      fileName: '  ',
      classSlug: '',
      subject: '',
      hasFile: false,
      contactMethod: '',
    });
    expect(missingFields(errors)).toEqual([
      'fileName',
      'classSlug',
      'subject',
      'file',
      'contactMethod',
    ]);
  });

  it('rejects a Drive link on an unrelated host', () => {
    const errors = validateContribution({
      ...valid,
      method: 'link',
      hasFile: false,
      driveLink: 'https://example.com/file/d/abc123',
    });
    expect(errors.driveLink).toMatch(/drive\.google\.com/);
    expect(errors.file).toBeUndefined();
  });

  it('rejects a link that is not a URL at all', () => {
    const errors = validateContribution({
      ...valid,
      method: 'link',
      driveLink: 'drive.google.com/file/d/abc123',
    });
    expect(errors.driveLink).toBeTruthy();
  });

  it('does not ask for a file when the link method is selected', () => {
    const errors = validateContribution({ ...valid, method: 'link', hasFile: false });
    expect(errors.file).toBeUndefined();
  });

  it('does not ask for a link when uploading', () => {
    const errors = validateContribution({ ...valid, driveLink: 'not a link' });
    expect(errors.driveLink).toBeUndefined();
  });

  it('keeps the field order stable for focus management', () => {
    expect(CONTRIBUTION_FIELD_ORDER[0]).toBe('fileName');
    expect(CONTRIBUTION_FIELD_ORDER.at(-1)).toBe('contactMethod');
  });
});
