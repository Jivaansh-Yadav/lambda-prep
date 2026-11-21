import {
  CATEGORY_LABELS,
  createDefaultFilters,
  type AdvancedSearchFilters,
  type MatchMode,
  type ResourceCategoryTag,
  type SearchScope,
  type SortOption,
} from '@/lib/advanced-search';
import { FILE_KIND_LABEL, type FileKind } from '@/lib/resources-data';

/**
 * The library's filters, as they appear in the address bar.
 *
 * Why the URL and not just sessionStorage: a filtered search is a *place*.
 * `?q=prelims&class=icse-10&kind=pdf` can be sent to a classmate, bookmarked,
 * reloaded, and — the case that matters most here — returned to with Back
 * after opening a file, without any of it depending on what this browser did
 * last Tuesday. Storage made the library reopen somebody's old search; the URL
 * only ever shows what the link asked for.
 *
 * Everything is a single comma-joined value rather than repeated keys: no facet
 * value in the catalogue contains a comma (checked across every group, subject,
 * year and class slug), and one key per facet keeps the URL readable.
 */

export type SourceTag = 'cisce' | 'community';

export interface LibrarySearch {
  q?: string;
  not?: string;
  mode?: MatchMode;
  scope?: SearchScope;
  kind?: FileKind[];
  cat?: ResourceCategoryTag[];
  year?: string[];
  group?: string[];
  subject?: string[];
  class?: string[];
  src?: SourceTag[];
  sort?: SortOption;
}

/** Every key this codec owns. Anything else in the query string (a `file`
 * deep link, a campaign tag) is left exactly where it is. */
const KEYS = ['q', 'not', 'mode', 'scope', 'kind', 'cat', 'year', 'group', 'subject', 'class', 'src', 'sort'] as const;

const FILE_KINDS = Object.keys(FILE_KIND_LABEL) as FileKind[];
const CATEGORY_TAGS = Object.keys(CATEGORY_LABELS) as ResourceCategoryTag[];
const MATCH_MODES: readonly MatchMode[] = ['smart', 'exact', 'startsWith', 'regex'];
const SCOPES: readonly SearchScope[] = ['all', 'filename'];
const SORTS: readonly SortOption[] = ['relevance', 'name-asc', 'name-desc', 'newest', 'largest', 'smallest'];
const SOURCES: readonly SourceTag[] = ['cisce', 'community'];

/** Free-text facet lists (group / subject / class names) come straight from the
 * query string, so they get a sanity cap instead of an allowlist. */
const MAX_LIST_ITEMS = 24;
const MAX_ITEM_LENGTH = 80;

function readString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key];
  return typeof value === 'string' ? value : '';
}

/** Trimmed form, for the enumerated params where whitespace is never meaningful. */
function readToken(raw: Record<string, unknown>, key: string): string {
  return readString(raw, key).trim();
}

/** Keeps the values the app knows about, in the order they were written. */
function readEnumerated<T extends string>(raw: Record<string, unknown>, key: string, allowed: readonly T[]): T[] {
  const out: T[] = [];
  for (const part of readToken(raw, key).split(',')) {
    const value = part.trim();
    if (allowed.includes(value as T) && !out.includes(value as T)) out.push(value as T);
  }
  return out;
}

/** Same, for facet names we can't enumerate here. */
function readNames(raw: Record<string, unknown>, key: string): string[] {
  const out: string[] = [];
  for (const part of readToken(raw, key).split(',')) {
    const value = part.trim();
    if (value && value.length <= MAX_ITEM_LENGTH && !out.includes(value)) out.push(value);
    if (out.length === MAX_LIST_ITEMS) break;
  }
  return out;
}

/**
 * Route `validateSearch`. Returns only the keys that are actually set, so a
 * plain `<Link to="/resources">` stays a link with no search object attached.
 *
 * `q` and `not` keep their exact text — trailing spaces included. The URL is
 * rewritten on every keystroke, so a round trip that trimmed would swallow the
 * space the moment someone starts typing a second word.
 */
export function parseLibrarySearch(raw: Record<string, unknown>): LibrarySearch {
  const q = readString(raw, 'q');
  const not = readString(raw, 'not');
  const mode = readEnumerated(raw, 'mode', MATCH_MODES)[0];
  const scope = readEnumerated(raw, 'scope', SCOPES)[0];
  const sort = readEnumerated(raw, 'sort', SORTS)[0];
  const kind = readEnumerated(raw, 'kind', FILE_KINDS);
  const cat = readEnumerated(raw, 'cat', CATEGORY_TAGS);
  const src = readEnumerated(raw, 'src', SOURCES);
  const year = readNames(raw, 'year');
  const group = readNames(raw, 'group');
  const subject = readNames(raw, 'subject');
  const cls = readNames(raw, 'class');

  return {
    ...(q ? { q } : {}),
    ...(not ? { not } : {}),
    // Non-default modes only: `smart` and `all` are what the bar shows anyway,
    // and spelling them out would triple the length of every shared link.
    ...(mode && mode !== 'smart' ? { mode } : {}),
    ...(scope && scope !== 'all' ? { scope } : {}),
    ...(kind.length ? { kind } : {}),
    ...(cat.length ? { cat } : {}),
    ...(year.length ? { year } : {}),
    ...(group.length ? { group } : {}),
    ...(subject.length ? { subject } : {}),
    ...(cls.length ? { class: cls } : {}),
    ...(src.length ? { src } : {}),
    ...(sort && sort !== 'relevance' ? { sort } : {}),
  };
}

/** True when the URL is asking for something — a term or any facet. */
export function hasLibrarySearch(search: LibrarySearch): boolean {
  return KEYS.some(key => {
    const value = search[key as keyof LibrarySearch];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
}

/** The filters a URL describes, on top of the defaults. */
export function filtersFromSearch(search: LibrarySearch): AdvancedSearchFilters {
  return {
    ...createDefaultFilters(),
    query: search.q ?? '',
    excludeQuery: search.not ?? '',
    matchMode: search.mode ?? 'smart',
    searchScope: search.scope ?? 'all',
    fileKinds: [...(search.kind ?? [])],
    categories: [...(search.cat ?? [])],
    years: [...(search.year ?? [])],
    groups: [...(search.group ?? [])],
    subjects: [...(search.subject ?? [])],
    classSlugs: [...(search.class ?? [])],
    sources: [...(search.src ?? [])],
    sortBy: search.sort ?? 'relevance',
  };
}

/** The URL a set of filters deserves — defaults are omitted, not written out. */
export function searchFromFilters(filters: AdvancedSearchFilters): LibrarySearch {
  // Not trimmed: see parseLibrarySearch. An all-space query is still nothing, so
  // only a truly empty box clears the param.
  const query = filters.query;
  const excludeQuery = filters.excludeQuery;
  const join = (values: readonly string[]) => values.join(',');
  return parseLibrarySearch({
    q: query,
    not: excludeQuery,
    mode: filters.matchMode,
    scope: filters.searchScope,
    kind: join(filters.fileKinds),
    cat: join(filters.categories),
    year: join(filters.years),
    group: join(filters.groups),
    subject: join(filters.subjects),
    class: join(filters.classSlugs),
    src: join(filters.sources),
    sort: filters.sortBy,
  });
}

/**
 * Writes the filters into an existing query string: sets the keys that apply
 * and removes the ones that no longer do, leaving every other param untouched.
 */
export function applyFiltersToParams(params: URLSearchParams, filters: AdvancedSearchFilters): void {
  const search = searchFromFilters(filters);
  for (const key of KEYS) {
    const value = search[key as keyof LibrarySearch];
    if (Array.isArray(value)) {
      if (value.length) params.set(key, value.join(','));
      else params.delete(key);
    } else if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }
}

/** True when two filter sets describe the same URL — used to skip the render
 * that would otherwise follow a URL the page itself just wrote. */
export function filtersDescribeSameUrl(a: AdvancedSearchFilters, b: AdvancedSearchFilters): boolean {
  return librarySearchKey(searchFromFilters(a)) === librarySearchKey(searchFromFilters(b));
}

/** A stable key for "did the URL change", so effects can react to real
 * changes rather than to a fresh object identity on every render. */
export function librarySearchKey(search: LibrarySearch): string {
  return KEYS.map(key => {
    const value = search[key as keyof LibrarySearch];
    return `${key}=${Array.isArray(value) ? value.join(',') : (value ?? '')}`;
  }).join('&');
}
