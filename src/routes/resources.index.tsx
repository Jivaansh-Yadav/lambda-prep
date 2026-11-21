import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { ArrowUpRight, File, FileImage, FileSpreadsheet, FileText, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { classes, pageHead } from '@/lib/lambda-prep';
import { useI18n } from '@/lib/i18n';
import {
  FILE_KIND_LABEL,
  loadAllLibraryFiles,
  type FileKind,
  type ResourceSearchHit,
} from '@/lib/resources-data';
import {
  createDefaultFilters,
  hasActiveSearchOrFilters,
  type AdvancedSearchFilters,
  type EnrichedSearchableFile,
  type MatchMode,
  type RawSearchableFile,
} from '@/lib/advanced-search';
import { formatFileSize } from '@/lib/format';

import { useAdvancedFileSearch } from '@/hooks/use-advanced-file-search';
import { AdvancedSearchBar, HighlightedFilename } from '@/components/lambda-prep/advanced-search-bar';
import { VirtualFileGrid } from '@/components/lambda-prep/virtual-file-grid';
import { FileRatingBadge } from '@/components/lambda-prep/file-rating-badge';
import { Button } from '@/components/ui/button';
import { CommunityLinks } from '@/components/lambda-prep/community-links';
import {
  applyFiltersToParams,
  filtersDescribeSameUrl,
  filtersFromSearch,
  hasLibrarySearch,
  librarySearchKey,
  parseLibrarySearch,
  type LibrarySearch,
} from '@/lib/library-url';

export const Route = createFileRoute('/resources/')({
  // The address bar *is* the library's state: `?q=` plus one key per active
  // facet (`kind=pdf,docx`, `class=icse-10`, `sort=newest`, …). That is how the
  // header quick search hands a term over, how a filtered search gets shared,
  // and why Back from a file returns to the same result list. A bare
  // `/resources` therefore stays bare — nothing to replay from storage.
  validateSearch: (search: Record<string, unknown>): LibrarySearch => parseLibrarySearch(search),
  head: () => pageHead('Resource library', 'Find your ICSE and ISC class and explore subject-wise learning resources.', '/resources'),
  component: Resources,
});

/** Seed queries for the idle state — a blank search box gives no hint of what
 * the filename index actually rewards (board codes, school names, doc types). */
const QUICK_SEARCHES = ['Specimen', 'PYQ 2024', 'Revision notes', '-solution', 'Analysis of Pupil Performance'];

const FILE_KIND_META: Record<FileKind, { icon: typeof FileText; tone: string; label: string }> = {
  pdf: { icon: FileText, tone: 'rose', label: FILE_KIND_LABEL.pdf },
  docx: { icon: File, tone: 'blue', label: FILE_KIND_LABEL.docx },
  xlsx: { icon: FileSpreadsheet, tone: 'green', label: FILE_KIND_LABEL.xlsx },
  pptx: { icon: File, tone: 'amber', label: FILE_KIND_LABEL.pptx },
  image: { icon: FileImage, tone: 'purple', label: FILE_KIND_LABEL.image },
  other: { icon: FileText, tone: 'teal', label: FILE_KIND_LABEL.other },
};

function GlobalHitCard({
  entry,
  highlightTerms,
  matchMode,
  rawQuery,
}: {
  entry: EnrichedSearchableFile;
  highlightTerms: readonly string[];
  matchMode: MatchMode;
  rawQuery: string;
}) {
  const meta = FILE_KIND_META[entry.fileKind];
  const Icon = meta.icon;
  const sourcePath = entry.source === 'cisce' ? '/resources/cisce' : '/resources/community';
  const sourceLabel = entry.source === 'cisce' ? 'CISCE' : 'Community';
  const cls = classes.find(c => c.slug === entry.classSlug);
  const classLabel = cls ? `${cls.board} ${cls.grade}` : undefined;
  const sizeLabel = formatFileSize(entry.sizeBytes);
  const metaParts = [meta.label, sourceLabel, entry.primaryYear, sizeLabel].filter(Boolean) as string[];
  const locationParts = [classLabel, entry.subject, entry.folderTrail || undefined].filter(Boolean) as string[];

  return (
    <Link
      to={sourcePath}
      search={{ class: entry.classSlug, subject: entry.subject, file: entry.item.id }}
      title={entry.item.name}
      className={`resource-file-card tone-${meta.tone}`}
    >
      <FileRatingBadge fileId={entry.item.id} />
      <span className="resource-file-icon"><Icon size={26} strokeWidth={1.6} /></span>
      <span className="resource-file-name">
        <HighlightedFilename
          name={entry.item.name}
          highlightTerms={highlightTerms}
          matchMode={matchMode}
          rawQuery={rawQuery}
        />
      </span>
      <span className="resource-file-search-meta">
        <span className="resource-file-type">{metaParts.join(' · ')}</span>
        <span className="resource-file-context-line" title={locationParts.join(' · ')}>
          {locationParts.join(' · ')}
        </span>
      </span>
    </Link>
  );
}

/** Resource Library hub with unified global filename search across Community and Official CISCE files. */
function Resources() {
  const { t } = useI18n();
  const router = useRouter();
  const urlSearch = Route.useSearch();
  // Seeded straight from the URL, on the server and on the client alike, so the
  // first paint already shows the filtered state a shared link asked for.
  const [filters, setFilters] = useState<AdvancedSearchFilters>(() => filtersFromSearch(urlSearch));
  const searchKey = librarySearchKey(urlSearch);
  // What the URL said last time an effect compared it. Seeded, so the mount
  // render (which already matches) isn't treated as a navigation away.
  const lastSearchKey = useRef(searchKey);
  const [corpusRequested, setCorpusRequested] = useState(false);
  const [libraryHits, setLibraryHits] = useState<ResourceSearchHit[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!corpusRequested) return;
    let cancelled = false;
    setLoading(true);
    loadAllLibraryFiles(classes.map(c => c.slug))
      .then(hits => {
        if (!cancelled) {
          setLibraryHits(hits);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.error('[resources] failed to load global library search index', err);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [corpusRequested]);

  const rawFiles = useMemo<RawSearchableFile[]>(
    () => (libraryHits ?? []).map(h => ({
      item: h.item,
      classSlug: h.classSlug,
      subject: h.subject,
      source: h.source,
      folderPath: h.folderPath,
    })),
    [libraryHits]
  );

  const search = useAdvancedFileSearch(rawFiles, filters, 120);

  const stuckSentinelRef = useRef<HTMLDivElement>(null);
  const [barStuck, setBarStuck] = useState(false);

  // Collapse the quick-filter chips once the bar is pinned to the viewport, so
  // the toolbar costs one row of screen space instead of three while the
  // student reads results.
  useEffect(() => {
    const el = stuckSentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setBarStuck(!entry?.isIntersecting), { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The URL can change under a mounted page: the header quick search navigates
  // to `/resources?q=…`, and the nav link goes back to a bare `/resources`.
  // Either way the filters follow the address bar rather than drifting from it.
  useEffect(() => {
    if (lastSearchKey.current === searchKey) return;
    lastSearchKey.current = searchKey;
    const fromUrl = filtersFromSearch(urlSearch);
    // Same URL, new object: keep the existing state so a keystroke doesn't cost
    // an extra render and a fresh search pass.
    setFilters(current => (filtersDescribeSameUrl(current, fromUrl) ? current : fromUrl));
    if (hasLibrarySearch(urlSearch)) setCorpusRequested(true);
    // `urlSearch` is described completely by `searchKey`; depending on the
    // object itself would fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchKey]);

  // Same-route quick search: navigating to `/resources?q=…` when the library is
  // already mounted can resolve to identical router state (searching the same
  // term twice, say), so the header also fires this event.
  useEffect(() => {
    function onQuickSearch(event: Event) {
      const term = (event as CustomEvent<string>).detail;
      if (typeof term !== 'string' || !term.trim()) return;
      setFilters(current => ({ ...current, query: term }));
      setCorpusRequested(true);
    }
    window.addEventListener('lambda-prep:quick-search', onQuickSearch);
    return () => window.removeEventListener('lambda-prep:quick-search', onQuickSearch);
  }, []);

  // Restored filters arrive without any user interaction, so the corpus load
  // that AdvancedSearchBar normally triggers on typing has to happen here.
  useEffect(() => {
    if (hasActiveSearchOrFilters(filters)) setCorpusRequested(true);
  }, [filters]);

  // Every filter change is written back into the address bar, term and facets
  // alike, so a filtered search is shareable, refreshable, and restored by Back.
  //
  // It goes through the router's history rather than `window.history`: a raw
  // `replaceState` leaves the router convinced the URL still says something
  // else, so the next nav-link click would rewrite the bar from that stale view
  // and the filters would quietly stop matching it. `replace` keeps the browser
  // and the router on the same page without adding Back-stack entries (ten
  // keystrokes must not become ten stops on the way out).
  useEffect(() => {
    const url = new URL(window.location.href);
    applyFiltersToParams(url.searchParams, filters);
    if (url.href !== window.location.href) {
      router.history.replace(`${url.pathname}${url.search}${url.hash}`, window.history.state);
    }
  }, [filters, router]);

  return (
    <main className="container content-page">
      <div className="content-header">
        <h1>{t('resources.title')}<span className="text-primary">.</span></h1>
        <p className="page-intro">{t('resources.intro')}</p>
      </div>

      <div ref={stuckSentinelRef} className="adv-sticky-sentinel" aria-hidden="true" />
      <div className={`adv-sticky${barStuck ? ' is-stuck' : ''}`}>
      <AdvancedSearchBar
        filters={filters}
        onChange={setFilters}
        facets={search.facets}
        totalCount={search.enrichedItems.length}
        matchCount={search.results.length}
        loading={loading}
        error={search.error}
        placeholder="Search every filename — try “DAIS phy 2024”, “specimen”, “-solution”…"
        ariaLabel="Search all study resource filenames"
        showSourceFilter
        showClassFilter
        showSubjectFilter
        onActivateCorpus={() => setCorpusRequested(true)}
      />
      </div>

      {search.isActive ? (
        loading && !libraryHits ? (
          <div className="resource-file-grid resource-search-results" aria-busy="true">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />
            ))}
          </div>
        ) : search.results.length ? (
          search.results.length > 60 ? (
            <VirtualFileGrid
              windowScroll
              className="resource-file-grid-virtual resource-search-results is-windowed"
              items={search.results}
              minColumnWidth={210}
              rowHeight={174}
              renderItem={entry => (
                <GlobalHitCard
                  key={`${entry.source}-${entry.classSlug}-${entry.subject}-${entry.item.id}`}
                  entry={entry}
                  highlightTerms={search.highlightTerms}
                  matchMode={filters.matchMode}
                  rawQuery={filters.query}
                />
              )}
            />
          ) : (
            <div className="resource-file-grid resource-search-results">
              {search.results.map(entry => (
                <GlobalHitCard
                  key={`${entry.source}-${entry.classSlug}-${entry.subject}-${entry.item.id}`}
                  entry={entry}
                  highlightTerms={search.highlightTerms}
                  matchMode={filters.matchMode}
                  rawQuery={filters.query}
                />
              ))}
            </div>
          )
        ) : (
          <div className="empty-state">
            <Search />
            <h3>No matching files found</h3>
            <p>Try adjusting your filename pattern, switching match mode, or clearing one of the active filters.</p>
            <Button variant="outline" onClick={() => setFilters(createDefaultFilters())}>Reset filters</Button>
          </div>
        )
      ) : (
        <>
          <div className="library-quick-searches">
            <span className="library-quick-label">Try searching for</span>
            {QUICK_SEARCHES.map(example => (
              <button
                key={example}
                type="button"
                className="adv-facet-btn"
                onClick={() => {
                  setCorpusRequested(true);
                  setFilters(current => ({ ...current, query: example }));
                }}
              >
                {example}
              </button>
            ))}
          </div>
          <div className="source-grid">
          <div className="source-card tone-green">
            <Link to="/resources/community" className="source-card-link" aria-label={t('resources.community.title')} />
            <span className="subject-icon"><UsersRound /></span>
            <h3>{t('resources.community.title')}</h3>
            <p><CommunityLinks /></p>
            <div className="card-bottom">{t('resources.explore')} <ArrowUpRight size={18} /></div>
          </div>
          <div className="source-card tone-blue">
            <Link to="/resources/cisce" className="source-card-link" aria-label={t('resources.cisce.title')} />
            <span className="subject-icon"><ShieldCheck /></span>
            <h3>{t('resources.cisce.title')}</h3>
            <p>{t('resources.cisce.descPrefix')} <a href="https://cisce.org" target="_blank" rel="noreferrer">cisce.org</a> {t('resources.cisce.descSuffix')}</p>
            <div className="card-bottom">{t('resources.explore')} <ArrowUpRight size={18} /></div>
          </div>
          </div>
        </>
      )}
    </main>
  );
}
