import Fuse, { type IFuseOptions } from 'fuse.js';
import {
  getFileKind,
  getGroupLabel,
  type FileKind,
  type ResourceItem,
} from '@/lib/resources-data';

export type MatchMode = 'smart' | 'exact' | 'startsWith' | 'regex';
export type SearchScope = 'all' | 'filename';
export type SortOption = 'relevance' | 'name-asc' | 'name-desc' | 'newest' | 'largest' | 'smallest';

export type ResourceCategoryTag =
  | 'prelims'
  | 'pyq'
  | 'sample'
  | 'solutions'
  | 'notes'
  | 'cfq'
  | 'syllabus';

export interface CategoryMeta {
  id: ResourceCategoryTag;
  label: string;
  shortLabel: string;
}

export const RESOURCE_CATEGORIES: readonly CategoryMeta[] = [
  { id: 'prelims', label: 'Prelims & Pre-boards', shortLabel: 'Prelims' },
  { id: 'pyq', label: 'Past Papers (PYQs)', shortLabel: 'PYQs' },
  { id: 'sample', label: 'Sample & Specimen', shortLabel: 'Sample / SQP' },
  { id: 'solutions', label: 'Solutions & Keys', shortLabel: 'Solutions' },
  { id: 'notes', label: 'Notes & Revision', shortLabel: 'Notes' },
  { id: 'cfq', label: 'CFQs & Q-Banks', shortLabel: 'CFQs' },
  { id: 'syllabus', label: 'Syllabus & Scope', shortLabel: 'Syllabus' },
];

export const CATEGORY_LABELS: Record<ResourceCategoryTag, string> = {
  prelims: 'Prelims',
  pyq: 'PYQs',
  sample: 'Sample / SQP',
  solutions: 'Solutions',
  notes: 'Notes',
  cfq: 'CFQs',
  syllabus: 'Syllabus',
};

export interface AdvancedSearchFilters {
  query: string;
  excludeQuery: string;
  matchMode: MatchMode;
  searchScope: SearchScope;
  fileKinds: FileKind[];
  categories: ResourceCategoryTag[];
  years: string[];
  groups: string[];
  subjects: string[];
  classSlugs: string[];
  sources: Array<'cisce' | 'community'>;
  sortBy: SortOption;
}

export function createDefaultFilters(): AdvancedSearchFilters {
  return {
    query: '',
    excludeQuery: '',
    matchMode: 'smart',
    searchScope: 'all',
    fileKinds: [],
    categories: [],
    years: [],
    groups: [],
    subjects: [],
    classSlugs: [],
    sources: [],
    sortBy: 'relevance',
  };
}

export function countActiveStructuredFilters(filters: AdvancedSearchFilters): number {
  let count = 0;
  if (filters.excludeQuery.trim()) count += 1;
  if (filters.matchMode !== 'smart') count += 1;
  if (filters.searchScope !== 'all') count += 1;
  count += filters.fileKinds.length;
  count += filters.categories.length;
  count += filters.years.length;
  count += filters.groups.length;
  count += filters.subjects.length;
  count += filters.classSlugs.length;
  count += filters.sources.length;
  if (filters.sortBy !== 'relevance') count += 1;
  return count;
}

export function hasActiveSearchOrFilters(filters: AdvancedSearchFilters): boolean {
  return (
    filters.query.trim().length > 0 ||
    filters.excludeQuery.trim().length > 0 ||
    filters.fileKinds.length > 0 ||
    filters.categories.length > 0 ||
    filters.years.length > 0 ||
    filters.groups.length > 0 ||
    filters.subjects.length > 0 ||
    filters.classSlugs.length > 0 ||
    filters.sources.length > 0
  );
}

export interface RawSearchableFile {
  item: ResourceItem;
  classSlug?: string | undefined;
  subject?: string | undefined;
  source?: 'cisce' | 'community' | undefined;
  folderPath?: readonly string[] | undefined;
}

export interface EnrichedSearchableFile {
  item: ResourceItem;
  classSlug: string | undefined;
  subject: string | undefined;
  source: 'cisce' | 'community' | undefined;
  folderPath: string[];
  folderTrail: string;
  displayGroup: string;
  fileKind: FileKind;
  categories: ResourceCategoryTag[];
  years: string[];
  primaryYear: string | null;
  sizeBytes: number | null;
  modifiedMs: number | null;
  /** Pre-computed normalized lowercase filename for instant filtering. */
  nameLower: string;
  /** Filename without extension, separators normalized to spaces. */
  nameTokensText: string;
  /** Combined lowercase filename + folder path + display group + subject. */
  fullLower: string;
  /** Token-friendly combined text for smart multi-term matching. */
  fullTokensText: string;
}

// Common student shorthand <-> canonical filename synonyms.
// Expanding these lets a query like "phy prelim sol" match "Physics_Preboard_Solution.pdf".
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['phy', 'physics'],
  ['chem', 'chemistry'],
  ['bio', 'biology'],
  ['math', 'maths', 'mathematics'],
  ['eng', 'english'],
  ['lit', 'literature'],
  ['lang', 'language'],
  ['hist', 'history'],
  ['civ', 'civics'],
  ['geo', 'geog', 'geography'],
  ['comp', 'computer', 'cta', 'cs'],
  ['comm', 'commercial', 'commerce'],
  ['eco', 'econ', 'economics'],
  ['acc', 'accounts', 'accountancy'],
  ['sol', 'soln', 'solns', 'solution', 'solutions', 'solved', 'ans', 'answer', 'answers', 'key', 'marking scheme'],
  ['prelim', 'prelims', 'preboard', 'pre-board', 'pre board', 'mock', 'terminal'],
  ['sqp', 'specimen', 'sample', 'model'],
  ['pyq', 'pyqs', 'past paper', 'previous year', 'board paper', 'main examination'],
  ['cfq', 'cfqs', 'competency', 'hots', 'question bank', 'qbank'],
  ['apf', 'analysis', 'pupil performance'],
  ['ch', 'chap', 'chapter'],
  ['imp', 'important'],
  ['rev', 'revision', 'notes', 'summary', 'handout'],
  ['syl', 'syllabus', 'curriculum', 'scope'],
];

const SYNONYM_MAP = new Map<string, readonly string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYM_MAP.set(term, group);
  }
}

function normalizeForTokens(input: string): string {
  return input
    .toLowerCase()
    .replace(/[_\-./\\()[\],]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extract all academic/exam years (2010–2029) from a file's name, folder path, and group.
 * Handles both explicit 4-digit years ("2024", "2025") and academic shorthand ranges
 * like "23-24", "24-25", "2023-24", "2025-26". */
export function extractYears(text: string): string[] {
  const found = new Set<string>();

  // 4-digit years: 2010–2029
  const fourDigitMatches = text.match(/(?:^|[^0-9])(20[12][0-9])(?:[^0-9]|$)/g);
  if (fourDigitMatches) {
    for (const raw of fourDigitMatches) {
      const m = /(20[12][0-9])/.exec(raw);
      if (m?.[1]) found.add(m[1]);
    }
  }

  // Shorthand ranges like "2023-24", "2024-25", "23-24", "22-23"
  const rangeRegex = /(?:^|[^0-9])((?:20)?([12][0-9]))\s*[-–/]\s*((?:20)?([12][0-9]))(?:[^0-9]|$)/g;
  let match: RegExpExecArray | null;
  while ((match = rangeRegex.exec(text)) !== null) {
    const startTwo = Number(match[2]);
    const endTwo = Number(match[4]);
    // Only treat consecutive academic years as year ranges (e.g. 23-24, 24-25),
    // avoiding chapter ranges like "10-12" or marks like "15-20".
    if (endTwo === startTwo + 1 && startTwo >= 12 && endTwo <= 29) {
      found.add(`20${match[2]}`);
      found.add(`20${match[4]}`);
    }
  }

  return Array.from(found).sort((a, b) => Number(b) - Number(a));
}

const CATEGORY_PATTERNS: ReadonlyArray<{ tag: ResourceCategoryTag; regex: RegExp }> = [
  {
    tag: 'prelims',
    regex: /\b(prelim|prelims|pre[\s_-]?board|pre[\s_-]?boards|mock|terminal|half[\s_-]?yearly|rehearsal)\b/i,
  },
  {
    tag: 'pyq',
    regex: /\b(pyq|pyqs|past\s*paper|previous\s*year|board\s*paper|main\s*examination|improvement\s*examination|ten\s*years|10\s*years)\b/i,
  },
  {
    tag: 'sample',
    regex: /\b(sample|specimen|sqp|model\s*paper|practice\s*paper)\b/i,
  },
  {
    tag: 'solutions',
    regex: /\b(solution|solutions|soln|solns|solved|answer|answers|ans\s*key|answer\s*key|marking\s*scheme|apf|pupil\s*performance|analysis\s*of\s*pupil)\b/i,
  },
  {
    tag: 'notes',
    regex: /\b(note|notes|revision|quick\s*revision|summary|cheat\s*sheet|formula|formulae|mind\s*map|handout|brief|chapter\s*notes|study\s*material|workbook|guide)\b/i,
  },
  {
    tag: 'cfq',
    regex: /\b(cfq|cfqs|competency|hots|case\s*study|assertion|mcq|mcqs|question\s*bank|qbank|important\s*questions|worksheet)\b/i,
  },
  {
    tag: 'syllabus',
    regex: /\b(syllabus|curriculum|scope\s*of\s*syllabus|blueprint|regulations|bifurcated|reduced)\b/i,
  },
];

export function detectCategories(text: string): ResourceCategoryTag[] {
  const tags: ResourceCategoryTag[] = [];
  for (const { tag, regex } of CATEGORY_PATTERNS) {
    if (regex.test(text)) {
      tags.push(tag);
    }
  }
  return tags;
}

function parseBytes(size: string | number | null | undefined): number | null {
  if (typeof size === 'number' && Number.isFinite(size)) return size;
  if (typeof size === 'string' && size.trim() !== '') {
    const parsed = Number(size);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function parseTimestamp(modifiedTime?: string | null, createdTime?: string | null): number | null {
  const raw = modifiedTime || createdTime;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export function enrichSearchableFiles(entries: readonly RawSearchableFile[]): EnrichedSearchableFile[] {
  return entries.map(entry => {
    const { item, classSlug, subject, source } = entry;
    const folderPath = entry.folderPath ? [...entry.folderPath] : [];
    const folderTrail = folderPath.join(' / ');
    const displayGroup = getGroupLabel(item.group);
    const fileKind = getFileKind(item.name);

    const combinedForMetadata = [item.name, folderTrail, item.group, displayGroup]
      .filter(Boolean)
      .join(' ');
    const years = extractYears(combinedForMetadata);
    const categories = detectCategories(combinedForMetadata);
    const nameLower = item.name.toLowerCase();
    const nameTokensText = normalizeForTokens(item.name.replace(/\.[a-z0-9]{1,6}$/i, ''));
    const fullRaw = [item.name, folderTrail, displayGroup, item.group, subject ?? '']
      .filter(Boolean)
      .join(' ');
    const fullLower = fullRaw.toLowerCase();
    const fullTokensText = normalizeForTokens(fullRaw);

    return {
      item,
      classSlug,
      subject,
      source,
      folderPath,
      folderTrail,
      displayGroup,
      fileKind,
      categories,
      years,
      primaryYear: years[0] ?? null,
      sizeBytes: parseBytes(item.size),
      modifiedMs: parseTimestamp(item.modifiedTime, item.createdTime),
      nameLower,
      nameTokensText,
      fullLower,
      fullTokensText,
    };
  });
}

export interface FacetOption<T extends string = string> {
  value: T;
  label: string;
  count: number;
}

export interface SearchFacets {
  fileKinds: FacetOption<FileKind>[];
  categories: FacetOption<ResourceCategoryTag>[];
  years: FacetOption<string>[];
  groups: FacetOption<string>[];
  subjects: FacetOption<string>[];
  classSlugs: FacetOption<string>[];
  sources: FacetOption<'cisce' | 'community'>[];
}

const FILE_KIND_ORDER: readonly FileKind[] = ['pdf', 'docx', 'image', 'pptx', 'xlsx', 'other'];
const FILE_KIND_DISPLAY: Record<FileKind, string> = {
  pdf: 'PDF',
  docx: 'DOCX',
  image: 'Images',
  pptx: 'PPTX',
  xlsx: 'XLSX',
  other: 'Other',
};

const CLASS_ORDER = ['icse-9', 'icse-10', 'isc-11', 'isc-12'];
const CLASS_LABELS: Record<string, string> = {
  'icse-9': 'ICSE Class 9',
  'icse-10': 'ICSE Class 10',
  'isc-11': 'ISC Class 11',
  'isc-12': 'ISC Class 12',
};

export function computeAvailableFacets(items: readonly EnrichedSearchableFile[]): SearchFacets {
  const kindCounts = new Map<FileKind, number>();
  const catCounts = new Map<ResourceCategoryTag, number>();
  const yearCounts = new Map<string, number>();
  const groupCounts = new Map<string, number>();
  const subjectCounts = new Map<string, number>();
  const classCounts = new Map<string, number>();
  const sourceCounts = new Map<'cisce' | 'community', number>();

  for (const entry of items) {
    kindCounts.set(entry.fileKind, (kindCounts.get(entry.fileKind) ?? 0) + 1);
    for (const cat of entry.categories) {
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
    for (const yr of entry.years) {
      yearCounts.set(yr, (yearCounts.get(yr) ?? 0) + 1);
    }
    if (entry.displayGroup) {
      groupCounts.set(entry.displayGroup, (groupCounts.get(entry.displayGroup) ?? 0) + 1);
    }
    if (entry.subject) {
      subjectCounts.set(entry.subject, (subjectCounts.get(entry.subject) ?? 0) + 1);
    }
    if (entry.classSlug) {
      classCounts.set(entry.classSlug, (classCounts.get(entry.classSlug) ?? 0) + 1);
    }
    if (entry.source) {
      sourceCounts.set(entry.source, (sourceCounts.get(entry.source) ?? 0) + 1);
    }
  }

  const fileKinds = FILE_KIND_ORDER.filter(k => (kindCounts.get(k) ?? 0) > 0).map(k => ({
    value: k,
    label: FILE_KIND_DISPLAY[k],
    count: kindCounts.get(k) ?? 0,
  }));

  const categories = RESOURCE_CATEGORIES.filter(c => (catCounts.get(c.id) ?? 0) > 0).map(c => ({
    value: c.id,
    label: c.shortLabel,
    count: catCounts.get(c.id) ?? 0,
  }));

  const years = Array.from(yearCounts.entries())
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([value, count]) => ({ value, label: value, count }));

  const groups = Array.from(groupCounts.entries())
    .sort((a, b) => {
      if (a[0] === "Editor's Choice") return -1;
      if (b[0] === "Editor's Choice") return 1;
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .map(([value, count]) => ({ value, label: value, count }));

  const subjects = Array.from(subjectCounts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: value, count }));

  const classSlugs = Array.from(classCounts.entries())
    .sort((a, b) => {
      const ia = CLASS_ORDER.indexOf(a[0]);
      const ib = CLASS_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    })
    .map(([value, count]) => ({ value, label: CLASS_LABELS[value] ?? value, count }));

  const sources: FacetOption<'cisce' | 'community'>[] = [];
  if ((sourceCounts.get('community') ?? 0) > 0) {
    sources.push({ value: 'community', label: 'Community', count: sourceCounts.get('community') ?? 0 });
  }
  if ((sourceCounts.get('cisce') ?? 0) > 0) {
    sources.push({ value: 'cisce', label: 'Official CISCE', count: sourceCounts.get('cisce') ?? 0 });
  }

  return { fileKinds, categories, years, groups, subjects, classSlugs, sources };
}

interface ParsedSmartQuery {
  /** Each inner array is an OR group; all groups are AND-ed together. */
  includeGroups: Array<Array<{ raw: string; exactPhrase: boolean; wildcardRegex?: RegExp }>>;
  excludeTerms: string[];
  highlightTerms: string[];
  hasSpecialSyntax: boolean;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map(part => part.split('?').map(escapeRegex).join('.'))
    .join('.*');
  return new RegExp(escaped, 'i');
}

export function parseSmartQuery(raw: string): ParsedSmartQuery {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { includeGroups: [], excludeTerms: [], highlightTerms: [], hasSpecialSyntax: false };
  }

  // Split by whitespace while preserving quoted phrases and negative prefixes (-"foo bar")
  const tokens: string[] = [];
  const tokenRegex = /-?"[^"]+"|\S+/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(trimmed)) !== null) {
    tokens.push(m[0]);
  }

  const includeGroups: Array<Array<{ raw: string; exactPhrase: boolean; wildcardRegex?: RegExp }>> = [];
  const excludeTerms: string[] = [];
  const highlightTerms: string[] = [];
  let hasSpecialSyntax = false;
  let pendingOr = false;

  for (const tok of tokens) {
    if (tok === 'OR' || tok === '|') {
      pendingOr = true;
      hasSpecialSyntax = true;
      continue;
    }

    // Exclusion: -term or !term or -"exact phrase"
    if ((tok.startsWith('-') || tok.startsWith('!')) && tok.length > 1) {
      hasSpecialSyntax = true;
      const cleaned = tok.slice(1).replace(/^"|"$/g, '').trim().toLowerCase();
      if (cleaned) excludeTerms.push(cleaned);
      pendingOr = false;
      continue;
    }

    // Inline pipe OR syntax: e.g. 2024|2025 or prelim|preboard
    if (tok.includes('|') && !tok.startsWith('"')) {
      hasSpecialSyntax = true;
      const parts = tok
        .split('|')
        .map(p => p.trim().toLowerCase())
        .filter(Boolean);
      if (parts.length) {
        const group = parts.map(p => {
          highlightTerms.push(p.replace(/[*?]/g, ''));
          return p.includes('*') || p.includes('?')
            ? { raw: p, exactPhrase: false, wildcardRegex: wildcardToRegex(p) }
            : { raw: p, exactPhrase: false };
        });
        includeGroups.push(group);
      }
      pendingOr = false;
      continue;
    }

    const isQuoted = tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2;
    const cleaned = (isQuoted ? tok.slice(1, -1) : tok).trim().toLowerCase();
    if (!cleaned) continue;

    if (isQuoted) hasSpecialSyntax = true;
    const hasWildcard = !isQuoted && (cleaned.includes('*') || cleaned.includes('?'));
    if (hasWildcard) hasSpecialSyntax = true;

    const item = hasWildcard
      ? { raw: cleaned, exactPhrase: false, wildcardRegex: wildcardToRegex(cleaned) }
      : { raw: cleaned, exactPhrase: isQuoted };

    const cleanHighlight = cleaned.replace(/[*?]/g, '');
    if (cleanHighlight) highlightTerms.push(cleanHighlight);

    if (pendingOr && includeGroups.length > 0) {
      includeGroups[includeGroups.length - 1]!.push(item);
    } else {
      includeGroups.push([item]);
    }
    pendingOr = false;
  }

  return { includeGroups, excludeTerms, highlightTerms, hasSpecialSyntax };
}

function parseExcludeInput(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map(s => s.trim().toLowerCase().replace(/^[-!]+/, ''))
    .filter(Boolean);
}

/** Score how strongly a single include clause matches an item (0 = no match, higher = better). */
function scoreClause(
  entry: EnrichedSearchableFile,
  clause: { raw: string; exactPhrase: boolean; wildcardRegex?: RegExp },
  searchScope: SearchScope
): number {
  const targetName = entry.nameLower;
  const targetFull = searchScope === 'filename' ? entry.nameLower : entry.fullLower;
  const targetTokens = searchScope === 'filename' ? entry.nameTokensText : entry.fullTokensText;

  if (clause.wildcardRegex) {
    if (clause.wildcardRegex.test(entry.item.name)) return 90;
    if (searchScope === 'all' && clause.wildcardRegex.test(entry.fullLower)) return 55;
    return 0;
  }

  if (clause.exactPhrase) {
    if (targetName.includes(clause.raw)) return 100;
    if (searchScope === 'all' && targetFull.includes(clause.raw)) return 65;
    return 0;
  }

  // Direct match on filename
  if (targetName.startsWith(clause.raw)) return 110;
  if (targetName.includes(clause.raw)) return 95;

  // Normalized token match (e.g. "act 3" matching "ACT_3" or "ACT-3")
  const normClause = normalizeForTokens(clause.raw);
  if (normClause && entry.nameTokensText.includes(normClause)) return 85;

  // Direct match on folder/group/subject if searching all fields
  if (searchScope === 'all' && (targetFull.includes(clause.raw) || (normClause && targetTokens.includes(normClause)))) {
    return 60;
  }

  // Synonym expansion match (e.g. "phy" matches "Physics", "sol" matches "Solution")
  const synonyms = SYNONYM_MAP.get(clause.raw);
  if (synonyms) {
    for (const syn of synonyms) {
      if (syn === clause.raw) continue;
      if (targetName.includes(syn)) return 72;
      if (searchScope === 'all' && targetFull.includes(syn)) return 48;
    }
  }

  return 0;
}

const FUSE_OPTIONS_ALL: IFuseOptions<EnrichedSearchableFile> = {
  threshold: 0.34,
  ignoreLocation: true,
  includeScore: true,
  keys: [
    { name: 'item.name', weight: 0.72 },
    { name: 'folderTrail', weight: 0.14 },
    { name: 'displayGroup', weight: 0.08 },
    { name: 'subject', weight: 0.06 },
  ],
};

const FUSE_OPTIONS_FILENAME: IFuseOptions<EnrichedSearchableFile> = {
  threshold: 0.34,
  ignoreLocation: true,
  includeScore: true,
  keys: ['item.name'],
};

export function createSearchFuseIndex(
  items: readonly EnrichedSearchableFile[],
  scope: SearchScope
): Fuse<EnrichedSearchableFile> {
  return new Fuse(items as EnrichedSearchableFile[], scope === 'filename' ? FUSE_OPTIONS_FILENAME : FUSE_OPTIONS_ALL);
}

export interface AdvancedSearchOutput {
  results: EnrichedSearchableFile[];
  error: string | null;
  highlightTerms: string[];
}

export function executeAdvancedSearch(
  items: readonly EnrichedSearchableFile[],
  filters: AdvancedSearchFilters,
  fuseIndex?: Fuse<EnrichedSearchableFile>
): AdvancedSearchOutput {
  // 1. Apply structured facet filters first (fast linear pass)
  const fileKindSet = filters.fileKinds.length ? new Set(filters.fileKinds) : null;
  const catSet = filters.categories.length ? new Set(filters.categories) : null;
  const yearSet = filters.years.length ? new Set(filters.years) : null;
  const groupSet = filters.groups.length ? new Set(filters.groups) : null;
  const subjectSet = filters.subjects.length ? new Set(filters.subjects) : null;
  const classSet = filters.classSlugs.length ? new Set(filters.classSlugs) : null;
  const sourceSet = filters.sources.length ? new Set(filters.sources) : null;
  const dedicatedExcludes = parseExcludeInput(filters.excludeQuery);

  let pool = items.filter(entry => {
    if (fileKindSet && !fileKindSet.has(entry.fileKind)) return false;
    if (catSet && !entry.categories.some(c => catSet.has(c))) return false;
    if (yearSet && !entry.years.some(y => yearSet.has(y))) return false;
    if (groupSet && !groupSet.has(entry.displayGroup)) return false;
    if (subjectSet && (!entry.subject || !subjectSet.has(entry.subject))) return false;
    if (classSet && (!entry.classSlug || !classSet.has(entry.classSlug))) return false;
    if (sourceSet && (!entry.source || !sourceSet.has(entry.source))) return false;

    if (dedicatedExcludes.length) {
      const target = filters.searchScope === 'filename' ? entry.nameLower : entry.fullLower;
      for (const term of dedicatedExcludes) {
        if (target.includes(term)) return false;
      }
    }
    return true;
  });

  // 2. Apply text query according to selected matchMode
  const rawQuery = filters.query.trim();
  const scores = new Map<EnrichedSearchableFile, number>();
  let highlightTerms: string[] = [];

  if (rawQuery) {
    if (filters.matchMode === 'exact') {
      const needle = rawQuery.toLowerCase();
      highlightTerms = [needle];
      pool = pool.filter(entry => {
        const nameHit = entry.nameLower.includes(needle);
        if (nameHit) {
          scores.set(entry, entry.nameLower.startsWith(needle) ? 120 : 100);
          return true;
        }
        if (filters.searchScope === 'all' && entry.fullLower.includes(needle)) {
          scores.set(entry, 65);
          return true;
        }
        return false;
      });
    } else if (filters.matchMode === 'startsWith') {
      const needle = rawQuery.toLowerCase();
      highlightTerms = [needle];
      pool = pool.filter(entry => {
        const hit = entry.nameLower.startsWith(needle);
        if (hit) scores.set(entry, 120);
        return hit;
      });
    } else if (filters.matchMode === 'regex') {
      let regex: RegExp;
      try {
        // Allow "/pattern/flags" shorthand or raw regex pattern
        const slashMatch = /^\/(.+)\/([gimsuy]*)$/.exec(rawQuery);
        if (slashMatch?.[1]) {
          const flags = slashMatch[2]?.includes('i') ? slashMatch[2] : `${slashMatch[2] ?? ''}i`;
          regex = new RegExp(slashMatch[1], flags.replace(/g/g, ''));
        } else {
          regex = new RegExp(rawQuery, 'i');
        }
      } catch (err) {
        return {
          results: [],
          error: err instanceof Error ? `Invalid pattern: ${err.message}` : 'Invalid regular expression pattern',
          highlightTerms: [],
        };
      }
      pool = pool.filter(entry => {
        if (regex.test(entry.item.name)) {
          scores.set(entry, 100);
          return true;
        }
        if (filters.searchScope === 'all' && regex.test(entry.fullLower)) {
          scores.set(entry, 60);
          return true;
        }
        return false;
      });
    } else {
      // 'smart' mode: multi-term AND/OR, quotes, -exclude, wildcards, abbreviations + Fuse fuzzy fallback
      const parsed = parseSmartQuery(rawQuery);
      highlightTerms = parsed.highlightTerms;

      // Apply inline -exclude terms
      if (parsed.excludeTerms.length) {
        pool = pool.filter(entry => {
          const target = filters.searchScope === 'filename' ? entry.nameLower : entry.fullLower;
          return !parsed.excludeTerms.some(ex => target.includes(ex));
        });
      }

      if (parsed.includeGroups.length > 0) {
        const strictMatches: EnrichedSearchableFile[] = [];
        for (const entry of pool) {
          let totalScore = 0;
          let matchedAll = true;
          for (const orGroup of parsed.includeGroups) {
            let bestInGroup = 0;
            for (const clause of orGroup) {
              const s = scoreClause(entry, clause, filters.searchScope);
              if (s > bestInGroup) bestInGroup = s;
            }
            if (bestInGroup === 0) {
              matchedAll = false;
              break;
            }
            totalScore += bestInGroup;
          }
          if (matchedAll) {
            // Bonus if the full raw query appears contiguously in filename
            if (entry.nameLower.includes(rawQuery.toLowerCase())) {
              totalScore += 45;
            }
            scores.set(entry, totalScore);
            strictMatches.push(entry);
          }
        }

        // If strict matching found results OR user explicitly used operators/wildcards, use those.
        // Otherwise fall back to Fuse.js fuzzy search for typo tolerance (e.g. "physiks prelm").
        if (strictMatches.length > 0 || parsed.hasSpecialSyntax) {
          pool = strictMatches;
        } else {
          const allowedSet = new Set(pool);
          const fuse = fuseIndex ?? createSearchFuseIndex(pool, filters.searchScope);
          const fuseHits = fuse.search(rawQuery);
          const fuzzyMatches: EnrichedSearchableFile[] = [];
          for (const hit of fuseHits) {
            if (!allowedSet.has(hit.item)) continue;
            scores.set(hit.item, Math.round((1 - (hit.score ?? 0.5)) * 100));
            fuzzyMatches.push(hit.item);
          }
          pool = fuzzyMatches;
        }
      }
    }
  }

  // 3. Apply sorting
  const sorted = [...pool];
  switch (filters.sortBy) {
    case 'name-asc':
      sorted.sort((a, b) => a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' }));
      break;
    case 'name-desc':
      sorted.sort((a, b) => b.item.name.localeCompare(a.item.name, undefined, { numeric: true, sensitivity: 'base' }));
      break;
    case 'newest':
      sorted.sort((a, b) => {
        const ya = a.primaryYear ? Number(a.primaryYear) : 0;
        const yb = b.primaryYear ? Number(b.primaryYear) : 0;
        if (yb !== ya) return yb - ya;
        const ma = a.modifiedMs ?? 0;
        const mb = b.modifiedMs ?? 0;
        if (mb !== ma) return mb - ma;
        return a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' });
      });
      break;
    case 'largest':
      sorted.sort((a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1));
      break;
    case 'smallest':
      sorted.sort((a, b) => {
        const sa = a.sizeBytes ?? Number.MAX_SAFE_INTEGER;
        const sb = b.sizeBytes ?? Number.MAX_SAFE_INTEGER;
        return sa - sb;
      });
      break;
    case 'relevance':
    default:
      if (rawQuery) {
        sorted.sort((a, b) => {
          const diff = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
          if (diff !== 0) return diff;
          return a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' });
        });
      } else {
        // When filtering by facets only (no text query), sort newest year first then name A-Z
        sorted.sort((a, b) => {
          const ya = a.primaryYear ? Number(a.primaryYear) : 0;
          const yb = b.primaryYear ? Number(b.primaryYear) : 0;
          if (yb !== ya) return yb - ya;
          return a.item.name.localeCompare(b.item.name, undefined, { numeric: true, sensitivity: 'base' });
        });
      }
      break;
  }

  return { results: sorted, error: null, highlightTerms };
}

export interface HighlightSegment {
  text: string;
  match: boolean;
}

/** Splits a filename into matched and non-matched runs for clean visual highlighting. */
export function getHighlightSegments(
  filename: string,
  highlightTerms: readonly string[],
  matchMode: MatchMode,
  rawQuery: string
): HighlightSegment[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [{ text: filename, match: false }];

  if (matchMode === 'startsWith') {
    if (filename.toLowerCase().startsWith(trimmed.toLowerCase())) {
      return [
        { text: filename.slice(0, trimmed.length), match: true },
        ...(filename.length > trimmed.length ? [{ text: filename.slice(trimmed.length), match: false }] : []),
      ];
    }
    return [{ text: filename, match: false }];
  }

  if (matchMode === 'regex') {
    try {
      const slashMatch = /^\/(.+)\/([gimsuy]*)$/.exec(trimmed);
      const pattern = slashMatch?.[1] ?? trimmed;
      const flags = slashMatch?.[2] ? `${slashMatch[2].replace(/g/g, '')}gi` : 'gi';
      const re = new RegExp(pattern, flags);
      const segments: HighlightSegment[] = [];
      let lastIndex = 0;
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(filename)) !== null && guard < 40) {
        guard += 1;
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        if (m.index > lastIndex) {
          segments.push({ text: filename.slice(lastIndex, m.index), match: false });
        }
        segments.push({ text: m[0], match: true });
        lastIndex = m.index + m[0].length;
      }
      if (lastIndex < filename.length) {
        segments.push({ text: filename.slice(lastIndex), match: false });
      }
      return segments.length ? segments : [{ text: filename, match: false }];
    } catch {
      return [{ text: filename, match: false }];
    }
  }

  // Build alternation from highlightTerms + any matched synonyms
  const terms = new Set<string>();
  for (const t of highlightTerms) {
    const clean = t.trim().toLowerCase();
    if (clean.length >= 2) {
      terms.add(clean);
      const syns = SYNONYM_MAP.get(clean);
      if (syns) {
        for (const s of syns) {
          if (s.length >= 2) terms.add(s);
        }
      }
    }
  }
  if (!terms.size) return [{ text: filename, match: false }];

  const sortedTerms = Array.from(terms).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${sortedTerms.map(escapeRegex).join('|')})`, 'gi');
  const parts = filename.split(re);
  if (parts.length <= 1) return [{ text: filename, match: false }];

  const segments: HighlightSegment[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    segments.push({ text: part, match: i % 2 === 1 });
  }
  return segments;
}

export function formatFileSize(sizeBytes: number | null): string | null {
  if (sizeBytes === null || sizeBytes <= 0) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  const mb = sizeBytes / (1024 * 1024);
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`;
}
