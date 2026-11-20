import { describe, expect, it } from 'vitest';
import {
  computeAvailableFacets,
  createDefaultFilters,
  detectCategories,
  enrichSearchableFiles,
  executeAdvancedSearch,
  extractYears,
  formatFileSize,
  getHighlightSegments,
  type RawSearchableFile,
} from './advanced-search';

const SAMPLE_FILES: RawSearchableFile[] = [
  {
    item: {
      id: '1',
      name: 'DAIS_Prelims_Physics_2025.pdf',
      group: 'PYQ Prelims · 2025 Prelim Papers',
      size: '2816465',
      modifiedTime: '2025-02-06T10:40:03.000Z',
    },
    classSlug: 'icse-10',
    subject: 'Physics',
    source: 'community',
  },
  {
    item: {
      id: '2',
      name: 'bss 2024 phy prelim solution.pdf',
      group: 'PYQ Prelims · 10th Prelims Papers 2023-24',
      size: '11213897',
      modifiedTime: '2024-01-26T18:04:39.000Z',
    },
    classSlug: 'icse-10',
    subject: 'Physics',
    source: 'community',
  },
  {
    item: {
      id: '3',
      name: 'Cathedral_Physics.docx',
      group: 'Sample Papers',
      size: '450000',
      modifiedTime: '2023-11-12T08:00:00.000Z',
    },
    classSlug: 'icse-10',
    subject: 'Physics',
    source: 'community',
  },
  {
    item: {
      id: '4',
      name: 'Act III Scene I - Brief Notes.pdf',
      group: 'General',
      size: '980000',
      modifiedTime: '2024-09-01T12:00:00.000Z',
    },
    classSlug: 'icse-10',
    subject: 'Literature in English',
    source: 'community',
    folderPath: ['Julius Caesar', 'ACT III', 'SCENE I'],
  },
  {
    item: {
      id: '5',
      name: 'ICSE_Specimen_Question_Paper_2026.pdf',
      group: 'CISCE Resources',
      size: '1500000',
      modifiedTime: '2025-07-01T12:00:00.000Z',
    },
    classSlug: 'icse-10',
    subject: 'Chemistry',
    source: 'cisce',
    folderPath: ['SQP', '2026'],
  },
];

describe('advanced-search engine', () => {
  const enriched = enrichSearchableFiles(SAMPLE_FILES);

  it('extracts 4-digit years and shorthand academic year ranges', () => {
    expect(extractYears('10th Prelims Papers 2023-24')).toEqual(['2024', '2023']);
    expect(extractYears('ICSEians Prelim Papers 10th (24-25)')).toEqual(['2025', '2024']);
    expect(extractYears('Chapter 10-12 Notes 2025.pdf')).toEqual(['2025']);
  });

  it('detects study resource categories accurately from filenames and folders', () => {
    expect(detectCategories('bss 2024 phy prelim solution.pdf')).toEqual(
      expect.arrayContaining(['prelims', 'solutions'])
    );
    expect(detectCategories('ICSE_Specimen_Question_Paper_2026.pdf SQP')).toContain('sample');
    expect(detectCategories('Act III Scene I - Brief Notes.pdf')).toContain('notes');
  });

  it('expands student abbreviations in smart search mode', () => {
    const out = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: 'phy sol',
    });
    expect(out.results.map(r => r.item.id)).toEqual(['2']);
  });

  it('supports inline -exclude and dedicated excludeQuery', () => {
    const inlineOut = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: 'prelim -solution',
    });
    expect(inlineOut.results.map(r => r.item.id)).toEqual(['1']);

    const fieldOut = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: 'prelim',
      excludeQuery: 'solution',
    });
    expect(fieldOut.results.map(r => r.item.id)).toEqual(['1']);
  });

  it('supports OR syntax and filename wildcards', () => {
    const orOut = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: 'DAIS | Cathedral',
    });
    expect(orOut.results.map(r => r.item.id).sort()).toEqual(['1', '3']);

    const wildcardOut = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: 'DAIS*2025*.pdf',
    });
    expect(wildcardOut.results.map(r => r.item.id)).toEqual(['1']);
  });

  it('supports startsWith, exact, and regex match modes with graceful regex error handling', () => {
    const startsOut = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: 'Cathedral',
      matchMode: 'startsWith',
    });
    expect(startsOut.results.map(r => r.item.id)).toEqual(['3']);

    const regexOut = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: '^(DAIS|ICSE)_.*202[56]',
      matchMode: 'regex',
    });
    expect(regexOut.results.map(r => r.item.id).sort()).toEqual(['1', '5']);

    const badRegex = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: '[unclosed(',
      matchMode: 'regex',
    });
    expect(badRegex.error).toBeTruthy();
    expect(badRegex.results).toEqual([]);
  });

  it('respects filename-only vs filename+folders scope', () => {
    const allScope = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: 'Julius Caesar',
      searchScope: 'all',
    });
    expect(allScope.results.map(r => r.item.id)).toEqual(['4']);

    const filenameOnly = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      query: '"Julius Caesar"',
      searchScope: 'filename',
    });
    expect(filenameOnly.results).toEqual([]);
  });

  it('filters by facets (file kind, year, source, category) and sorts properly', () => {
    const facets = computeAvailableFacets(enriched);
    expect(facets.fileKinds.map(f => f.value)).toEqual(['pdf', 'docx']);
    expect(facets.sources.map(s => s.value)).toEqual(['community', 'cisce']);

    const docxOnly = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      fileKinds: ['docx'],
    });
    expect(docxOnly.results.map(r => r.item.id)).toEqual(['3']);

    const byLargest = executeAdvancedSearch(enriched, {
      ...createDefaultFilters(),
      categories: ['prelims'],
      sortBy: 'largest',
    });
    expect(byLargest.results.map(r => r.item.id)).toEqual(['2', '1']);
  });

  it('highlights matched filename terms and formats file sizes cleanly', () => {
    const segs = getHighlightSegments('DAIS_Prelims_Physics_2025.pdf', ['dais', '2025'], 'smart', 'dais 2025');
    expect(segs.filter(s => s.match).map(s => s.text)).toEqual(['DAIS', '2025']);
    expect(formatFileSize(2816465)).toBe('2.7 MB');
    expect(formatFileSize(450000)).toBe('439 KB');
    expect(formatFileSize(null)).toBeNull();
  });
});
