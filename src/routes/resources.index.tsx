import { createFileRoute, Link } from '@tanstack/react-router';
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
  formatFileSize,
  type AdvancedSearchFilters,
  type EnrichedSearchableFile,
  type MatchMode,
  type RawSearchableFile,
} from '@/lib/advanced-search';
import { useAdvancedFileSearch } from '@/hooks/use-advanced-file-search';
import { AdvancedSearchBar, HighlightedFilename } from '@/components/lambda-prep/advanced-search-bar';
import { VirtualFileGrid } from '@/components/lambda-prep/virtual-file-grid';
import { FileRatingBadge } from '@/components/lambda-prep/file-rating-badge';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/resources/')({
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
  const [filters, setFilters] = useState<AdvancedSearchFilters>(createDefaultFilters);
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

  // ?q= keeps a search shareable and — more importantly — survives the trip into
  // a file view, so pressing Back returns to the same result list instead of an
  // empty library page.
  const hydratedFromUrl = useRef(false);
  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const initial = new URLSearchParams(window.location.search).get('q');
    if (!initial) return;
    setFilters(current => ({ ...current, query: initial }));
    setCorpusRequested(true);
  }, []);

  useEffect(() => {
    if (!hydratedFromUrl.current) return;
    const url = new URL(window.location.href);
    const trimmed = filters.query.trim();
    if (trimmed) url.searchParams.set('q', trimmed);
    else url.searchParams.delete('q');
    window.history.replaceState(window.history.state, '', url);
  }, [filters.query]);

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
            <p>{t('resources.community.descPrefix')} <a href="https://www.reddit.com/r/ICSE" target="_blank" rel="noreferrer">r/ICSE</a> and <a href="https://www.reddit.com/r/ISCNERDS/" target="_blank" rel="noreferrer">r/ISCNERDS</a> {t('resources.community.descMid')} <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ICSEcord</a> and <a href="https://discord.gg/7daJugjUA3" target="_blank" rel="noreferrer">ISCcord</a> {t('resources.community.descSuffix')}</p>
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
