import {
  AlertCircle,
  ArrowUpDown,
  ChevronDown,
  Clock,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CATEGORY_LABELS,
  countActiveStructuredFilters,
  createDefaultFilters,
  getHighlightSegments,
  hasActiveSearchOrFilters,
  type AdvancedSearchFilters,
  type MatchMode,
  type ResourceCategoryTag,
  type SearchFacets,
  type SearchScope,
  type SortOption,
} from '@/lib/advanced-search';
import {
  clearRecentSearches,
  loadRecentSearches,
  RECENT_SEARCHES_EVENT,
  RECENT_SEARCHES_STORAGE_KEY,
  removeRecentSearch,
  saveRecentSearch,
} from '@/lib/recent-searches';
import { FILE_KIND_LABEL, type FileKind } from '@/lib/resources-data';

/** Deterministic thousands grouping: the panel also renders during SSR, so it
 *  can't depend on the runtime's default locale. */
const formatCount = (n: number) => n.toLocaleString('en-US');

export interface AdvancedSearchBarProps {
  filters: AdvancedSearchFilters;
  onChange: (next: AdvancedSearchFilters) => void;
  facets: SearchFacets;
  totalCount: number;
  matchCount: number;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  placeholder: string;
  ariaLabel: string;
  /** Controls which scope-dependent facets can be shown in the filter drawer. */
  showSourceFilter?: boolean | undefined;
  showClassFilter?: boolean | undefined;
  showSubjectFilter?: boolean | undefined;
  showGroupFilter?: boolean | undefined;
  /** Called when the user opens the Filters drawer so lazy corpora (e.g. class/source/global) can load immediately. */
  onActivateCorpus?: (() => void) | undefined;
  /** Controlled or uncontrolled panel expansion callback. */
  defaultExpanded?: boolean | undefined;
}

const MATCH_MODE_OPTIONS: ReadonlyArray<{ value: MatchMode; label: string; hint: string }> = [
  { value: 'smart', label: 'Smart', hint: 'Words, abbreviations (phy, sol, sqp), "quotes", -exclude, * wildcards' },
  { value: 'exact', label: 'Exact phrase', hint: 'Exact case-insensitive text inside the filename' },
  { value: 'startsWith', label: 'Starts with', hint: 'Filename starts with your query (great for school names)' },
  { value: 'regex', label: 'Pattern / Regex', hint: 'Regular expression match, e.g. ^(DAIS|Cathedral).*202[45]' },
];

const SORT_OPTIONS: ReadonlyArray<{ value: SortOption; label: string }> = [
  { value: 'relevance', label: 'Best match' },
  { value: 'name-asc', label: 'Filename (A–Z)' },
  { value: 'name-desc', label: 'Filename (Z–A)' },
  { value: 'newest', label: 'Newest year first' },
  { value: 'largest', label: 'Largest file first' },
  { value: 'smallest', label: 'Smallest file first' },
];

const CLASS_SHORT_LABELS: Record<string, string> = {
  'icse-9': 'ICSE 9',
  'icse-10': 'ICSE 10',
  'isc-11': 'ISC 11',
  'isc-12': 'ISC 12',
};

function toggleInArray<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

/** Renders a filename with matched search fragments cleanly highlighted. */
export function HighlightedFilename({
  name,
  highlightTerms,
  matchMode,
  rawQuery,
}: {
  name: string;
  highlightTerms: readonly string[];
  matchMode: MatchMode;
  rawQuery: string;
}) {
  if (!rawQuery.trim()) return <>{name}</>;
  const segments = getHighlightSegments(name, highlightTerms, matchMode, rawQuery);
  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="adv-search-mark">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

export function AdvancedSearchBar({
  filters,
  onChange,
  facets,
  totalCount,
  matchCount,
  loading = false,
  error = null,
  placeholder,
  ariaLabel,
  showSourceFilter = false,
  showClassFilter = false,
  showSubjectFilter = false,
  showGroupFilter = false,
  onActivateCorpus,
  defaultExpanded = false,
}: AdvancedSearchBarProps) {
  const [panelOpen, setPanelOpen] = useState(defaultExpanded);
  // On phones the filter panel becomes a bottom sheet; on wider screens it stays
  // inline under the search bar.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 900px)');
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Lock the page behind the sheet so scrolling moves the filter list, not the
  // results underneath it.
  useEffect(() => {
    if (!panelOpen || !narrow) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [panelOpen, narrow]);
  const [showAllYears, setShowAllYears] = useState(false);
  const [showAllGroups, setShowAllGroups] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [recentOpen, setRecentOpen] = useState(false);
  // True only after the user pressed ArrowDown — lets them summon the recents
  // list while a query is already typed, without the panel auto-opening on
  // every keystroke.
  const [recentsPinned, setRecentsPinned] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(-1);
  const shellRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pendingScrollRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const structuredFilterCount = countActiveStructuredFilters(filters);
  const isActive = hasActiveSearchOrFilters(filters);

  // Hydrate recent searches from localStorage on client and keep synced across views/tabs.
  useEffect(() => {
    const sync = () => setRecentSearches(loadRecentSearches());
    sync();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === RECENT_SEARCHES_STORAGE_KEY) sync();
    };
    window.addEventListener(RECENT_SEARCHES_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(RECENT_SEARCHES_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Automatically record meaningful queries after the student pauses typing (900ms)
  // so clicking directly into a result card still remembers the search.
  useEffect(() => {
    const trimmed = filters.query.trim();
    if (trimmed.length < 2) return;
    const timer = setTimeout(() => {
      setRecentSearches(prev => saveRecentSearch(trimmed, prev));
    }, 900);
    return () => clearTimeout(timer);
  }, [filters.query]);

  // Close Recent Searches dropdown on outside pointer click.
  useEffect(() => {
    if (!recentOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setRecentOpen(false);
        setRecentsPinned(false);
        setHighlightedIdx(-1);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [recentOpen]);

  // Press "/" anywhere outside an input to focus the file search box quickly.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
        return;
      }
      if (inputRef.current) {
        e.preventDefault();
        inputRef.current.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Recents are a starting suggestion, not a live autocomplete: once the user
  // is typing, the result grid behind the input is the better feedback, so the
  // dropdown only shows for an empty query — or when they explicitly ask for it
  // with ArrowDown.
  const visibleRecents = useMemo(() => {
    const trimmed = filters.query.trim().toLowerCase();
    if (!trimmed) return recentSearches;
    return recentSearches.filter(item => item.toLowerCase().includes(trimmed));
  }, [recentSearches, filters.query]);

  const showRecentDropdown =
    recentOpen && visibleRecents.length > 0 && (!filters.query.trim() || recentsPinned);

  const update = (patch: Partial<AdvancedSearchFilters>) => {
    onActivateCorpus?.();
    onChange({ ...filters, ...patch });
  };

  const commitQuery = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
      setRecentSearches(prev => saveRecentSearch(trimmed, prev));
    }
  };

  const selectRecent = (value: string) => {
    setRecentSearches(prev => saveRecentSearch(value, prev));
    update({ query: value });
    setRecentOpen(false);
    setRecentsPinned(false);
    setHighlightedIdx(-1);
  };

  const handleRemoveRecent = (value: string) => {
    setRecentSearches(prev => {
      const next = removeRecentSearch(value, prev);
      if (next.length === 0) setRecentOpen(false);
      return next;
    });
    setHighlightedIdx(-1);
  };

  const handleClearAllRecents = () => {
    setRecentSearches(clearRecentSearches());
    setRecentOpen(false);
    setHighlightedIdx(-1);
  };

  const resetAll = () => {
    onChange(createDefaultFilters());
  };

  // Closing the sheet with the backdrop or the footer button would otherwise
  // drop focus to <body>, sending keyboard users back to the top of the page.
  const closePanel = () => {
    setPanelOpen(false);
    if (!narrow || typeof window === 'undefined') return;
    window.requestAnimationFrame(() => toggleRef.current?.focus({ preventScroll: true }));
  };

  const togglePanel = () => {
    const next = !panelOpen;
    setPanelOpen(next);
    if (!next) return;
    onActivateCorpus?.();
    // The panel un-pins the toolbar while it is open (a sticky bar taller than
    // the viewport strands the panel's own footer), so bring the toolbar back
    // into view first instead of leaving it wherever the list was scrolled to.
    if (typeof window === 'undefined') return;
    pendingScrollRef.current = true;
  };

  // Runs after the panel has been laid out (the toolbar changes from sticky to
  // static at the same time), so the measured offset is the real one.
  useEffect(() => {
    if (!panelOpen || !pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    const el = shellRef.current;
    if (!el) return;
    if (el.getBoundingClientRect().top < 0) {
      el.scrollIntoView({ block: 'start' });
    }
  }, [panelOpen]);

  // Visible quick category tabs right below the search bar
  const quickCategories = facets.categories;
  const visibleYears = showAllYears ? facets.years : facets.years.slice(0, 7);
  const visibleGroups = showAllGroups ? facets.groups : facets.groups.slice(0, 6);
  const activeModeMeta = MATCH_MODE_OPTIONS.find(m => m.value === filters.matchMode) ?? MATCH_MODE_OPTIONS[0]!;

  // Build active filter summary items for one-click removal
  const activeRemovals: Array<{ key: string; label: string; onRemove: () => void }> = [];
  if (filters.matchMode !== 'smart') {
    activeRemovals.push({
      key: `mode-${filters.matchMode}`,
      label: `Mode: ${activeModeMeta.label}`,
      onRemove: () => update({ matchMode: 'smart' }),
    });
  }
  if (filters.searchScope === 'filename') {
    activeRemovals.push({
      key: 'scope-filename',
      label: 'Filename only',
      onRemove: () => update({ searchScope: 'all' }),
    });
  }
  if (filters.excludeQuery.trim()) {
    activeRemovals.push({
      key: 'exclude',
      label: `Exclude: ${filters.excludeQuery.trim()}`,
      onRemove: () => update({ excludeQuery: '' }),
    });
  }
  for (const s of filters.sources) {
    activeRemovals.push({
      key: `src-${s}`,
      label: s === 'cisce' ? 'Official CISCE' : 'Community',
      onRemove: () => update({ sources: filters.sources.filter(v => v !== s) }),
    });
  }
  for (const c of filters.classSlugs) {
    activeRemovals.push({
      key: `cls-${c}`,
      label: CLASS_SHORT_LABELS[c] ?? c,
      onRemove: () => update({ classSlugs: filters.classSlugs.filter(v => v !== c) }),
    });
  }
  for (const subj of filters.subjects) {
    activeRemovals.push({
      key: `subj-${subj}`,
      label: subj,
      onRemove: () => update({ subjects: filters.subjects.filter(v => v !== subj) }),
    });
  }
  for (const cat of filters.categories) {
    activeRemovals.push({
      key: `cat-${cat}`,
      label: CATEGORY_LABELS[cat],
      onRemove: () => update({ categories: filters.categories.filter(v => v !== cat) }),
    });
  }
  for (const yr of filters.years) {
    activeRemovals.push({
      key: `yr-${yr}`,
      label: `Year ${yr}`,
      onRemove: () => update({ years: filters.years.filter(v => v !== yr) }),
    });
  }
  for (const fk of filters.fileKinds) {
    activeRemovals.push({
      key: `fk-${fk}`,
      label: FILE_KIND_LABEL[fk],
      onRemove: () => update({ fileKinds: filters.fileKinds.filter(v => v !== fk) }),
    });
  }
  for (const g of filters.groups) {
    activeRemovals.push({
      key: `grp-${g}`,
      label: g,
      onRemove: () => update({ groups: filters.groups.filter(v => v !== g) }),
    });
  }

  return (
    <div className="adv-search-shell" ref={shellRef}>
      <div className="adv-search-row">
        <div className="adv-search-input-anchor" ref={anchorRef}>
          <label className={`search-field adv-search-input-wrap${error ? ' has-error' : ''}`}>
            <Search size={17} className="adv-search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-label={ariaLabel}
              aria-expanded={showRecentDropdown}
              aria-controls={showRecentDropdown ? listboxId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                showRecentDropdown && highlightedIdx >= 0 ? `${listboxId}-opt-${highlightedIdx}` : undefined
              }
              placeholder={placeholder}
              value={filters.query}
              onFocus={() => {
                onActivateCorpus?.();
                setRecentOpen(true);
                setRecentsPinned(false);
              }}
              onBlur={() => {
                commitQuery(filters.query);
              }}
              onChange={e => {
                update({ query: e.target.value });
                setRecentOpen(true);
                setRecentsPinned(false);
                setHighlightedIdx(-1);
              }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown' && !showRecentDropdown && recentSearches.length > 0) {
                  e.preventDefault();
                  setRecentOpen(true);
                  setRecentsPinned(true);
                  setHighlightedIdx(0);
                  return;
                }
                if (e.key === 'ArrowDown' && showRecentDropdown) {
                  e.preventDefault();
                  setHighlightedIdx(idx => (idx + 1) % visibleRecents.length);
                  return;
                }
                if (e.key === 'ArrowUp' && showRecentDropdown) {
                  e.preventDefault();
                  setHighlightedIdx(idx => (idx <= 0 ? visibleRecents.length - 1 : idx - 1));
                  return;
                }
                if (e.key === 'Enter') {
                  if (showRecentDropdown && highlightedIdx >= 0 && visibleRecents[highlightedIdx]) {
                    e.preventDefault();
                    selectRecent(visibleRecents[highlightedIdx]!);
                  } else {
                    commitQuery(filters.query);
                    setRecentOpen(false);
                    setHighlightedIdx(-1);
                  }
                  return;
                }
                if (e.key === 'Escape') {
                  if (showRecentDropdown) {
                    e.preventDefault();
                    setRecentOpen(false);
                    setRecentsPinned(false);
                    setHighlightedIdx(-1);
                  } else if (filters.query) {
                    e.preventDefault();
                    update({ query: '' });
                  }
                }
              }}
            />
            {filters.query ? (
              <button
                type="button"
                className="adv-search-clear-btn"
                aria-label="Clear search query"
                onClick={() => {
                  update({ query: '' });
                  inputRef.current?.focus();
                }}
              >
                <X size={15} />
              </button>
            ) : (
              <kbd className="adv-search-kbd" aria-hidden="true" title="Press / to search">
                /
              </kbd>
            )}
          </label>

          {showRecentDropdown && (
            <div className="adv-recent-dropdown" role="region" aria-label="Recent searches">
              <div className="adv-recent-header">
                <span className="adv-recent-title">Recent searches</span>
                <button
                  type="button"
                  className="adv-recent-clear-all"
                  onMouseDown={e => e.preventDefault()}
                  onClick={handleClearAllRecents}
                >
                  Clear all
                </button>
              </div>
              <ul id={listboxId} role="listbox" className="adv-recent-list">
                {visibleRecents.map((entry, idx) => {
                  const highlighted = idx === highlightedIdx;
                  return (
                    <li
                      key={entry}
                      id={`${listboxId}-opt-${idx}`}
                      role="option"
                      aria-selected={highlighted}
                      className={`adv-recent-item${highlighted ? ' is-highlighted' : ''}`}
                      onMouseEnter={() => setHighlightedIdx(idx)}
                    >
                      <button
                        type="button"
                        className="adv-recent-select"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => selectRecent(entry)}
                      >
                        <Clock size={14} className="adv-recent-icon" aria-hidden="true" />
                        <span className="adv-recent-text">{entry}</span>
                      </button>
                      <button
                        type="button"
                        className="adv-recent-remove"
                        aria-label={`Remove "${entry}" from recent searches`}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => handleRemoveRecent(entry)}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <div className="adv-search-controls">
          <button
            type="button"
            ref={toggleRef}
            className={`adv-filter-toggle${panelOpen || structuredFilterCount > 0 ? ' is-active' : ''}`}
            aria-expanded={panelOpen}
            onClick={togglePanel}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span>Filters</span>
            {structuredFilterCount > 0 && (
              <span className="adv-filter-count" aria-label={`${structuredFilterCount} active filters`}>
                {structuredFilterCount}
              </span>
            )}
            <ChevronDown size={14} className={`adv-filter-chevron${panelOpen ? ' is-open' : ''}`} aria-hidden="true" />
          </button>

          {isActive && (
            <span className="adv-mobile-count" aria-hidden="true">
              <strong>{matchCount.toLocaleString()}</strong>
              <span>{matchCount === 1 ? ' file' : ' files'}</span>
            </span>
          )}

          {(isActive || panelOpen) && (
            <label className="adv-sort-wrap">
              <ArrowUpDown size={14} aria-hidden="true" />
              <select
                aria-label="Sort results"
                className="adv-sort-select"
                value={filters.sortBy}
                onChange={e => update({ sortBy: e.target.value as SortOption })}
              >
                {SORT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {error && (
        <div className="adv-search-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Quick one-click category filter buttons when corpus has tagged resources */}
      {quickCategories.length > 0 && (
        <div className="adv-quick-bar" role="group" aria-label="Quick resource category filters">
          {quickCategories.map(cat => {
            const active = filters.categories.includes(cat.value);
            return (
              <button
                key={cat.value}
                type="button"
                aria-pressed={active}
                className={`adv-facet-btn${active ? ' is-selected' : ''}`}
                onClick={() => update({ categories: toggleInArray<ResourceCategoryTag>(filters.categories, cat.value) })}
              >
                <span>{cat.label}</span>
                <span className="adv-facet-num">{formatCount(cat.count)}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Expandable Advanced Search & Filename Filter Panel */}
      {panelOpen && (
        <>
        {narrow && (
          <div className="adv-sheet-backdrop" onClick={closePanel} aria-hidden="true" />
        )}
        <section
          className={`adv-filter-panel${narrow ? ' is-sheet' : ''}`}
          aria-label="Advanced filename search filters"
          role={narrow ? 'dialog' : undefined}
          aria-modal={narrow ? true : undefined}
        >
          {narrow && (
            <div className="adv-sheet-head">
              <span className="adv-sheet-title">Filters</span>
              <button
                type="button"
                className="adv-sheet-close"
                aria-label="Close filters"
                onClick={closePanel}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className="adv-filter-grid-top">
            {/* Filename Matching Mode */}
            <div className="adv-filter-group">
              <span className="adv-filter-label">Filename match mode</span>
              <div className="adv-segmented" role="group" aria-label="Filename match mode">
                {MATCH_MODE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={filters.matchMode === opt.value}
                    className={`adv-seg-btn${filters.matchMode === opt.value ? ' is-selected' : ''}`}
                    onClick={() => update({ matchMode: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="adv-filter-hint">{activeModeMeta.hint}</p>
            </div>

            {/* Search Scope */}
            <div className="adv-filter-group">
              <span className="adv-filter-label">Search inside</span>
              <div className="adv-segmented" role="group" aria-label="Search scope">
                {(
                  [
                    { value: 'all', label: 'Filename + Folders' },
                    { value: 'filename', label: 'Filename only' },
                  ] as ReadonlyArray<{ value: SearchScope; label: string }>
                ).map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={filters.searchScope === opt.value}
                    className={`adv-seg-btn${filters.searchScope === opt.value ? ' is-selected' : ''}`}
                    onClick={() => update({ searchScope: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Exclude words from filename */}
            <div className="adv-filter-group">
              <label className="adv-filter-label" htmlFor="adv-exclude-input">
                Exclude words
              </label>
              <div className="adv-exclude-wrap">
                <input
                  id="adv-exclude-input"
                  type="text"
                  className="adv-exclude-input"
                  placeholder="e.g. solution, hindi, answer"
                  value={filters.excludeQuery}
                  onChange={e => update({ excludeQuery: e.target.value })}
                />
                {filters.excludeQuery && (
                  <button
                    type="button"
                    className="adv-search-clear-btn"
                    aria-label="Clear excluded words"
                    onClick={() => update({ excludeQuery: '' })}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="adv-filter-divider" />

          {loading && totalCount === 0 ? (
            <p className="adv-loading-note">Loading file index for filters…</p>
          ) : (
            <div className="adv-facets-stack">
              {/* Source filter (Global /resources search) */}
              {showSourceFilter && facets.sources.length > 1 && (
                <div className="adv-facet-row">
                  <span className="adv-filter-label">Source</span>
                  <div className="adv-facet-list">
                    {facets.sources.map(src => {
                      const selected = filters.sources.includes(src.value);
                      return (
                        <button
                          key={src.value}
                          type="button"
                          aria-pressed={selected}
                          className={`adv-facet-btn${selected ? ' is-selected' : ''}`}
                          onClick={() => update({ sources: toggleInArray(filters.sources, src.value) })}
                        >
                          <span>{src.label}</span>
                          <span className="adv-facet-num">{formatCount(src.count)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Class filter (Global & Source levels) */}
              {showClassFilter && facets.classSlugs.length > 1 && (
                <div className="adv-facet-row">
                  <span className="adv-filter-label">Class</span>
                  <div className="adv-facet-list">
                    {facets.classSlugs.map(cls => {
                      const selected = filters.classSlugs.includes(cls.value);
                      return (
                        <button
                          key={cls.value}
                          type="button"
                          aria-pressed={selected}
                          className={`adv-facet-btn${selected ? ' is-selected' : ''}`}
                          onClick={() => update({ classSlugs: toggleInArray(filters.classSlugs, cls.value) })}
                        >
                          <span>{CLASS_SHORT_LABELS[cls.value] ?? cls.label}</span>
                          <span className="adv-facet-num">{formatCount(cls.count)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Subject filter (Global, Source & Class levels) */}
              {showSubjectFilter && facets.subjects.length > 1 && (
                <div className="adv-facet-row">
                  <span className="adv-filter-label">Subject</span>
                  <div className="adv-facet-list">
                    {facets.subjects.map(subj => {
                      const selected = filters.subjects.includes(subj.value);
                      return (
                        <button
                          key={subj.value}
                          type="button"
                          aria-pressed={selected}
                          className={`adv-facet-btn${selected ? ' is-selected' : ''}`}
                          onClick={() => update({ subjects: toggleInArray(filters.subjects, subj.value) })}
                        >
                          <span>{subj.label}</span>
                          <span className="adv-facet-num">{formatCount(subj.count)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Exam / Academic Year filter */}
              {facets.years.length > 0 && (
                <div className="adv-facet-row">
                  <span className="adv-filter-label">Year in filename</span>
                  <div className="adv-facet-list">
                    {visibleYears.map(yr => {
                      const selected = filters.years.includes(yr.value);
                      return (
                        <button
                          key={yr.value}
                          type="button"
                          aria-pressed={selected}
                          className={`adv-facet-btn${selected ? ' is-selected' : ''}`}
                          onClick={() => update({ years: toggleInArray(filters.years, yr.value) })}
                        >
                          <span>{yr.label}</span>
                          <span className="adv-facet-num">{formatCount(yr.count)}</span>
                        </button>
                      );
                    })}
                    {facets.years.length > 7 && (
                      <button
                        type="button"
                        className="adv-facet-more"
                        onClick={() => setShowAllYears(v => !v)}
                      >
                        {showAllYears ? 'Show fewer' : `+${facets.years.length - 7} older`}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* File extension / type filter */}
              {facets.fileKinds.length > 1 && (
                <div className="adv-facet-row">
                  <span className="adv-filter-label">File format</span>
                  <div className="adv-facet-list">
                    {facets.fileKinds.map(fk => {
                      const selected = filters.fileKinds.includes(fk.value);
                      return (
                        <button
                          key={fk.value}
                          type="button"
                          aria-pressed={selected}
                          className={`adv-facet-btn${selected ? ' is-selected' : ''}`}
                          onClick={() => update({ fileKinds: toggleInArray<FileKind>(filters.fileKinds, fk.value) })}
                        >
                          <span>{fk.label}</span>
                          <span className="adv-facet-num">{formatCount(fk.count)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Collection / Group filter (inside a Subject) */}
              {showGroupFilter && facets.groups.length > 1 && (
                <div className="adv-facet-row">
                  <span className="adv-filter-label">Collection</span>
                  <div className="adv-facet-list">
                    {visibleGroups.map(grp => {
                      const selected = filters.groups.includes(grp.value);
                      return (
                        <button
                          key={grp.value}
                          type="button"
                          aria-pressed={selected}
                          className={`adv-facet-btn${selected ? ' is-selected' : ''}`}
                          onClick={() => update({ groups: toggleInArray(filters.groups, grp.value) })}
                        >
                          <span>{grp.label}</span>
                          <span className="adv-facet-num">{formatCount(grp.count)}</span>
                        </button>
                      );
                    })}
                    {facets.groups.length > 6 && (
                      <button
                        type="button"
                        className="adv-facet-more"
                        onClick={() => setShowAllGroups(v => !v)}
                      >
                        {showAllGroups ? 'Show fewer' : `+${facets.groups.length - 6} more`}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {narrow && (
            <div className="adv-sheet-foot">
              <button type="button" className="adv-sheet-reset" onClick={resetAll}>
                <RotateCcw size={13} aria-hidden="true" />
                <span>Reset</span>
              </button>
              <button type="button" className="adv-sheet-apply" onClick={closePanel}>
                {loading && totalCount === 0
                  ? 'Searching…'
                  : `Show ${matchCount.toLocaleString()} ${matchCount === 1 ? 'file' : 'files'}`}
              </button>
            </div>
          )}
        </section>
        </>
      )}

      {/* Live results summary & removable active filters bar */}
      {isActive && (
        <div className="adv-results-summary" aria-live="polite">
          <div className="adv-results-count">
            {loading && totalCount === 0 ? (
              <span>Searching file index…</span>
            ) : (
              <>
                <strong className="tabular-nums">{matchCount.toLocaleString()}</strong>
                <span>
                  {matchCount === 1 ? ' matching file' : ' matching files'}
                  {totalCount > 0 ? ` of ${totalCount.toLocaleString()}` : ''}
                  {filters.query.trim() ? ` for “${filters.query.trim()}”` : ''}
                </span>
              </>
            )}
          </div>

          {activeRemovals.length > 0 && (
            <div className="adv-active-list">
              {activeRemovals.map(rem => (
                <button
                  key={rem.key}
                  type="button"
                  className="adv-active-rem"
                  onClick={rem.onRemove}
                  title={`Remove filter: ${rem.label}`}
                >
                  <span>{rem.label}</span>
                  <X size={12} aria-hidden="true" />
                </button>
              ))}
              <button type="button" className="adv-reset-btn" onClick={resetAll}>
                <RotateCcw size={13} aria-hidden="true" />
                <span>Reset all</span>
              </button>
            </div>
          )}

          {activeRemovals.length === 0 && filters.query.trim() && (
            <button type="button" className="adv-reset-btn" onClick={resetAll}>
              <RotateCcw size={13} aria-hidden="true" />
              <span>Clear search</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
