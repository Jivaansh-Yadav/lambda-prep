import { describe, expect, it } from 'vitest';
import { formatFileSize } from './format';

describe('formatFileSize', () => {
  it('is null for unknown or empty sizes', () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(0)).toBeNull();
    expect(formatFileSize(-5)).toBeNull();
    expect(formatFileSize(Number.NaN)).toBeNull();
  });

  it('switches units instead of showing 0.0 MB for small files', () => {
    expect(formatFileSize(812)).toBe('812 B');
    expect(formatFileSize(45_000)).toBe('44 KB');
    expect(formatFileSize(450_000)).toBe('439 KB');
    expect(formatFileSize(1024)).toBe('1 KB');
  });

  it('drops the decimal once a file is ten megabytes or larger', () => {
    expect(formatFileSize(2_816_465)).toBe('2.7 MB');
    expect(formatFileSize(15 * 1024 * 1024)).toBe('15 MB');
  });
});
