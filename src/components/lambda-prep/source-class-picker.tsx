import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronDown, ChevronUp, File, FileImage, FileSpreadsheet, FileText, Folder, MessageCircle, RefreshCw, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { classes, findSubjectMeta, getSiteOrigin, subjectMatchesStream } from '@/lib/lambda-prep';
import { useI18n } from '@/lib/i18n';
import { useGoBack } from '@/hooks/use-go-back';
import { useAdvancedFileSearch } from '@/hooks/use-advanced-file-search';
import {
  createDefaultFilters,
  hasActiveSearchOrFilters,
  type AdvancedSearchFilters,
  type EnrichedSearchableFile,
  type MatchMode,
  type RawSearchableFile,
} from '@/lib/advanced-search';
import { formatFileSize } from '@/lib/format';
import { usePersistedFilters } from '@/lib/search-state';

import {
  FILE_KIND_LABEL,
  flattenFolderFiles,
  flattenFolderFilesWithPath,
  findItemInSubject,
  getFileKind,
  getGroupBadge,
  getGroupLabel,
  groupItems,
  hasResourceDataset,
  isFolderNode,
  isPremiumGroup,
  loadAllClassFiles,
  loadAllSourceFiles,
  loadResourceManifest,
  loadResourceMisc,
  loadResourceSubject,
  type FileKind,
  type ResourceFolderNode,
  type ResourceItem,
  type ResourceManifest,
  type ResourceSearchHit,
  type ResourceSubject,
} from '@/lib/resources-data';
import { AdvancedSearchBar, HighlightedFilename } from '@/components/lambda-prep/advanced-search-bar';
import { ResourceWatch } from '@/components/lambda-prep/resource-watch';
import { BackLink } from '@/components/lambda-prep/back-link';
import { VirtualFileGrid } from '@/components/lambda-prep/virtual-file-grid';
import { FileRatingBadge } from '@/components/lambda-prep/file-rating-badge';
import { ClassTrending } from '@/components/lambda-prep/class-trending';
import { StreamTabs } from '@/components/lambda-prep/stream-tabs';
import { Button } from '@/components/ui/button';
import { CommunityLinks } from '@/components/lambda-prep/community-links';

export type SourceId = 'cisce' | 'community';

interface SourceClassPickerProps {
  source: SourceId;
  classSlug?: string | undefined;
  subject?: string | undefined;
  file?: string | undefined;
  stream?: string | undefined;
  onStreamChange?: (stream: string) => void;
  onFileChange?: (fileId: string | undefined, opts?: { replace?: boolean }) => void;
  title: string;
  desc: React.ReactNode;
  sourceCredit?: React.ReactNode;
}

const MISC_LABEL = 'Miscellaneous';

const FILE_KIND_META: Record<FileKind, { icon: typeof FileText; tone: string; label: string }> = {
  pdf: { icon: FileText, tone: 'rose', label: FILE_KIND_LABEL.pdf },
  docx: { icon: File, tone: 'blue', label: FILE_KIND_LABEL.docx },
  xlsx: { icon: FileSpreadsheet, tone: 'green', label: FILE_KIND_LABEL.xlsx },
  pptx: { icon: File, tone: 'amber', label: FILE_KIND_LABEL.pptx },
  image: { icon: FileImage, tone: 'purple', label: FILE_KIND_LABEL.image },
  other: { icon: FileText, tone: 'teal', label: FILE_KIND_LABEL.other },
};

function FileCard({ item, onClick }: { item: ResourceItem; onClick: () => void }) {
  const kind = getFileKind(item.name);
  const meta = FILE_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <button type="button" className={`resource-file-card tone-${meta.tone}`} onClick={onClick}>
      <FileRatingBadge fileId={item.id} />
      <span className="resource-file-icon"><Icon size={26} strokeWidth={1.6} /></span>
      <span className="resource-file-name">{item.name}</span>
      <span className="resource-file-type">{meta.label}</span>
    </button>
  );
}

/** Enriched file card used when subject-level advanced search/filtering is active.
 * Highlights filename matches and surfaces folder trail, detected year, and file size. */
function SearchFileCard({
  entry,
  highlightTerms,
  matchMode,
  rawQuery,
  onClick,
}: {
  entry: EnrichedSearchableFile;
  highlightTerms: readonly string[];
  matchMode: MatchMode;
  rawQuery: string;
  onClick: () => void;
}) {
  const meta = FILE_KIND_META[entry.fileKind];
  const Icon = meta.icon;
  const sizeLabel = formatFileSize(entry.sizeBytes);
  const metaParts = [meta.label, entry.primaryYear, sizeLabel].filter(Boolean) as string[];
  const contextTrail = entry.folderTrail || (entry.displayGroup !== "Editor's Choice" ? entry.displayGroup : "Editor's Choice");

  return (
    <button type="button" className={`resource-file-card tone-${meta.tone}`} onClick={onClick}>
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
        {contextTrail && <span className="resource-file-context-line" title={contextTrail}>{contextTrail}</span>}
      </span>
    </button>
  );
}

/** Broad (cross-subject / cross-class) search hit card with highlighted filename,
 * class/subject/folder context, year, and file size. */
function HitFileCard({
  entry,
  sourcePath,
  classLabel,
  stream,
  highlightTerms,
  matchMode,
  rawQuery,
}: {
  entry: EnrichedSearchableFile;
  sourcePath: string;
  classLabel?: string | undefined;
  stream?: string | undefined;
  highlightTerms: readonly string[];
  matchMode: MatchMode;
  rawQuery: string;
}) {
  const meta = FILE_KIND_META[entry.fileKind];
  const Icon = meta.icon;
  const sizeLabel = formatFileSize(entry.sizeBytes);
  const metaParts = [meta.label, entry.primaryYear, sizeLabel].filter(Boolean) as string[];
  const subjectLabel = entry.subject ?? MISC_LABEL;
  const locationParts = [classLabel, subjectLabel, entry.folderTrail || undefined].filter(Boolean) as string[];

  return (
    <Link
      to={sourcePath}
      search={{ class: entry.classSlug, subject: subjectLabel, file: entry.item.id, stream }}
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

function countFolderFiles(folder: ResourceFolderNode): number {
  let n = 0;
  for (const c of folder.children) {
    n += isFolderNode(c) ? countFolderFiles(c) : 1;
  }
  return n;
}

function FolderCard({ folder, onClick }: { folder: ResourceFolderNode; onClick: () => void }) {
  return (
    <button type="button" className="resource-file-card resource-folder-card tone-amber" onClick={onClick}>
      <span className="resource-file-icon"><Folder size={26} strokeWidth={1.6} /></span>
      <span className="resource-file-name">{folder.name}</span>
      <span className="resource-file-type">{countFolderFiles(folder)} FILES</span>
    </button>
  );
}

function EditorChoiceNav({ folders, items, onPick }: {
  folders: ResourceFolderNode[];
  items: ResourceItem[];
  onPick: (item: ResourceItem, folderScope: ResourceFolderNode | null) => void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState<ResourceFolderNode[]>([]);
  const [direction, setDirection] = useState<'in' | 'out'>('in');

  const current = path[path.length - 1];
  const currentFolders = current ? current.children.filter(isFolderNode) : folders;
  const currentFiles: ResourceItem[] = current
    ? current.children.filter((c): c is ResourceItem => !isFolderNode(c))
    : items;

  const openFolder = (folder: ResourceFolderNode) => {
    setDirection('in');
    setPath(p => [...p, folder]);
  };
  const goBack = () => {
    setDirection('out');
    setPath(p => p.slice(0, -1));
  };

  return (
    <div className="resource-editor-nav">
      {path.length > 0 && (
        <div className="resource-editor-crumbs">
          <button type="button" className="resource-editor-back" onClick={goBack}>
            <ArrowLeft size={14} /> {t('resources.editorChoice.back')}
          </button>
          <span className="resource-editor-crumb-trail">{path.map(f => f.name).join(' / ')}</span>
        </div>
      )}
      <div key={path.map(f => f.name).join('/')} className={`resource-file-grid resource-editor-grid slide-${direction}`}>
        {currentFolders.map(folder => (
          <FolderCard key={folder.name} folder={folder} onClick={() => openFolder(folder)} />
        ))}
        {currentFiles.map(item => (
          <FileCard key={item.id} item={item} onClick={() => onPick(item, current ?? null)} />
        ))}
      </div>
    </div>
  );
}

function GroupSection({ group, items, editorFolders, onPick }: {
  group: string;
  items: ResourceItem[];
  editorFolders?: ResourceFolderNode[] | undefined;
  onPick: (item: ResourceItem, folderScope?: ResourceFolderNode | null) => void;
}) {
  const { t } = useI18n();
  const label = getGroupLabel(group);
  const badge = getGroupBadge(group);
  const isGeneral = group.toLowerCase() === 'general';
  const isFeaturedGroup = group.toLowerCase() === 'featured';
  const premium = isPremiumGroup(group);
  const hasEditorFolders = !!editorFolders?.length;
  const [expanded, setExpanded] = useState(isGeneral || hasEditorFolders);
  const [overflows, setOverflows] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const displayCount = hasEditorFolders ? editorFolders!.reduce((n, f) => n + flattenFolderFiles(f).length, 0) : items.length;

  useEffect(() => {
    if (isGeneral || hasEditorFolders) return;
    const el = gridRef.current;
    if (!el) return;
    const update = () => {
      const cap = window.innerWidth <= 800 ? 580 : 278;
      setOverflows(el.scrollHeight > cap + 4);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [isGeneral, hasEditorFolders, items.length]);

  const showCollapseUi = !isGeneral && !hasEditorFolders && overflows;
  const shouldVirtualize = !isGeneral && !hasEditorFolders && expanded;

  return (
    <section className={`doxx-notes resource-group${isGeneral || hasEditorFolders ? ' resource-group-editors-choice' : isFeaturedGroup ? ' resource-group-featured-glow' : ''}`}>
      <div className="resource-group-head">
        <h2>
          <FileText size={18} /> {label}
          <span className="resource-count-badge">({displayCount})</span>
          {badge && (
            <span className={`resource-group-badge${premium ? ' is-premium' : ''}`} tabIndex={0}>
              <span className="resource-group-badge-fill">{badge}</span>
              {premium && (
                <span className="resource-group-tooltip" role="tooltip">
                  {t('resources.badge.editorsChoiceTooltip')}
                </span>
              )}
            </span>
          )}
        </h2>
      </div>
      {hasEditorFolders ? (
        <EditorChoiceNav folders={editorFolders!} items={items} onPick={onPick} />
      ) : shouldVirtualize ? (
        <VirtualFileGrid
          className="resource-file-grid-virtual"
          items={items}
          renderItem={item => <FileCard key={item.id} item={item} onClick={() => onPick(item)} />}
        />
      ) : (
        <div className={`resource-file-grid-wrap${expanded || !showCollapseUi ? ' is-expanded' : ''}`}>
          <div className="resource-file-grid" ref={gridRef}>
            {items.map(item => (
              <FileCard key={item.id} item={item} onClick={() => onPick(item)} />
            ))}
          </div>
          {showCollapseUi && !expanded && (
            <div className="resource-group-fade">
              <button type="button" className="resource-group-viewall" onClick={() => setExpanded(true)}>
                {t('resources.viewAll')} <span className="resource-count-badge">({items.length})</span> <ChevronDown size={16} />
              </button>
            </div>
          )}
        </div>
      )}
      {showCollapseUi && expanded && !shouldVirtualize && (
        <button type="button" className="resource-group-collapse" onClick={() => setExpanded(false)}>
          {t('resources.showLess')} <ChevronUp size={16} />
        </button>
      )}
    </section>
  );
}

export function SourceClassPicker({ source, classSlug, subject, file, stream, onStreamChange, onFileChange, title, desc, sourceCredit }: SourceClassPickerProps) {
  const { t } = useI18n();
  const { canGoBack, goBack } = useGoBack();

  // Advanced search & filter states for each navigation level. Each level gets
  // its own persisted slot keyed by what the student is looking at, so Back
  // (or a reload) restores the filtered view instead of an empty search, and
  // one class's filters never show up under another class (GH #12).
  const [sourceFilters, setSourceFilters] = usePersistedFilters(`source:${source}`);
  const [classFilters, setClassFilters] = usePersistedFilters(`class:${source}:${classSlug ?? ''}`);
  const [fileFilters, setFileFilters] = usePersistedFilters(
    `file:${source}:${classSlug ?? ''}:${subject ?? ''}`,
  );

  // Lazy corpus triggers so opening the Filters drawer immediately loads facets even before typing
  const [sourceCorpusRequested, setSourceCorpusRequested] = useState(false);
  const [classCorpusRequested, setClassCorpusRequested] = useState(false);

  // A restored search never passes through AdvancedSearchBar's onActivateCorpus
  // hook, so ask for the data here whenever the restored filters are active.
  useEffect(() => {
    if (hasActiveSearchOrFilters(sourceFilters)) setSourceCorpusRequested(true);
  }, [sourceFilters]);
  useEffect(() => {
    if (hasActiveSearchOrFilters(classFilters)) setClassCorpusRequested(true);
  }, [classFilters]);

  const [sourceHits, setSourceHits] = useState<ResourceSearchHit[] | undefined>(undefined);
  const [sourceHitsLoading, setSourceHitsLoading] = useState(false);
  const [classHits, setClassHits] = useState<ResourceSearchHit[] | undefined>(undefined);
  const [classHitsLoading, setClassHitsLoading] = useState(false);

  const [manifest, setManifest] = useState<ResourceManifest | undefined>(undefined);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestError, setManifestError] = useState(false);
  const [subjectError, setSubjectError] = useState(false);
  const [subjectEntry, setSubjectEntry] = useState<ResourceSubject | undefined>(undefined);
  const [miscItems, setMiscItems] = useState<ResourceItem[] | undefined>(undefined);
  const [subjectLoading, setSubjectLoading] = useState(false);

  const subjectKey = subject ? `${source}|${classSlug ?? ''}|${subject}` : '';
  const [loadedSubjectKey, setLoadedSubjectKey] = useState('');

  useEffect(() => {
    setClassFilters(createDefaultFilters());
    setClassCorpusRequested(false);
    setClassHits(undefined);
  }, [classSlug]);

  useEffect(() => {
    setFileFilters(createDefaultFilters());
  }, [classSlug, subject]);

  const sourcePath = source === 'cisce' ? '/resources/cisce' : '/resources/community';
  const currentClass = classSlug ? classes.find(c => c.slug === classSlug) : undefined;
  const hasDataset = classSlug ? hasResourceDataset(source, classSlug) : false;

  // Manifest fetch
  useEffect(() => {
    if (!classSlug || !hasDataset) { setManifest(undefined); return; }
    let cancelled = false;
    setManifestLoading(true);
    setManifestError(false);
    loadResourceManifest(source, classSlug).then(data => {
      if (!cancelled) { setManifest(data); setManifestLoading(false); }
    }).catch(error => {
      if (cancelled) return;
      console.error('[resources] failed to load manifest', source, classSlug, error);
      setManifestLoading(false);
      setManifestError(true);
    });
    return () => { cancelled = true; };
  }, [source, classSlug, hasDataset]);

  // Subject shard fetch
  useEffect(() => {
    if (!classSlug || !subject) { setSubjectEntry(undefined); setMiscItems(undefined); setLoadedSubjectKey(''); return; }
    let cancelled = false;
    setSubjectLoading(true);
    setSubjectError(false);
    setSubjectEntry(undefined);
    setMiscItems(undefined);
    setLoadedSubjectKey('');
    const fail = (error: unknown) => {
      if (cancelled) return;
      console.error('[resources] failed to load subject data', source, classSlug, subject, error);
      setSubjectLoading(false);
      setSubjectError(true);
    };
    if (subject === MISC_LABEL) {
      loadResourceMisc(source, classSlug).then(items => {
        if (!cancelled) { setMiscItems(items); setSubjectEntry(undefined); setLoadedSubjectKey(subjectKey); setSubjectLoading(false); }
      }).catch(fail);
    } else {
      loadResourceSubject(source, classSlug, subject).then(entry => {
        if (!cancelled) { setSubjectEntry(entry); setMiscItems(undefined); setLoadedSubjectKey(subjectKey); setSubjectLoading(false); }
      }).catch(fail);
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subjectKey is derived from exactly these three
  }, [source, classSlug, subject]);

  // Lazy load source-wide corpus when searching or opening filters at top level
  useEffect(() => {
    if (classSlug || !sourceCorpusRequested) return;
    let cancelled = false;
    setSourceHitsLoading(true);
    loadAllSourceFiles(source, classes.map(c => c.slug)).then(hits => {
      if (!cancelled) { setSourceHits(hits); setSourceHitsLoading(false); }
    }).catch(error => {
      if (cancelled) return;
      console.error('[resources] failed to load source-wide file search index', source, error);
      setSourceHitsLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- classSlug is a presence check only
  }, [source, !!classSlug, sourceCorpusRequested]);

  // Lazy load class-wide corpus when searching or opening filters at class level
  useEffect(() => {
    if (!classSlug || subject || !hasDataset || !classCorpusRequested) return;
    let cancelled = false;
    setClassHitsLoading(true);
    loadAllClassFiles(source, classSlug).then(hits => {
      if (!cancelled) { setClassHits(hits); setClassHitsLoading(false); }
    }).catch(error => {
      if (cancelled) return;
      console.error('[resources] failed to load class-wide file search index', source, classSlug, error);
      setClassHitsLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subject/hasDataset are presence checks only
  }, [source, classSlug, !!subject, hasDataset, classCorpusRequested]);

  const activeStream = currentClass?.board === 'ISC' ? (stream ?? 'All') : 'All';
  const subjectCards = useMemo((): Array<{ subject: string; count: number }> => {
    if (!manifest) return [];
    const cards = manifest.subjects
      .filter(s => s.subject === MISC_LABEL || s.subject === 'Featured' || subjectMatchesStream(s.subject, activeStream))
      .map(s => ({ subject: s.subject, count: s.count }));
    if (manifest.miscCount > 0) cards.push({ subject: MISC_LABEL, count: manifest.miscCount });
    const priority = (subj: string) => (subj === 'Featured' ? 0 : subj === MISC_LABEL ? 2 : 1);
    return [...cards].sort((a, b) => {
      const pa = priority(a.subject);
      const pb = priority(b.subject);
      if (pa !== pb) return pa - pb;
      return pa === 1 ? a.subject.localeCompare(b.subject) : 0;
    });
  }, [manifest, activeStream]);

  // Build enriched search corpora for all three levels
  const rawSourceFiles = useMemo<RawSearchableFile[]>(
    () => (sourceHits ?? []).map(h => ({
      item: h.item,
      classSlug: h.classSlug,
      subject: h.subject,
      source: h.source ?? source,
      folderPath: h.folderPath,
    })),
    [sourceHits, source]
  );
  const sourceSearch = useAdvancedFileSearch(rawSourceFiles, sourceFilters, 110);

  const rawClassFiles = useMemo<RawSearchableFile[]>(() => {
    const hits = classHits ?? [];
    const scoped = activeStream === 'All'
      ? hits
      : hits.filter(h => h.subject === MISC_LABEL || h.subject === 'Featured' || subjectMatchesStream(h.subject, activeStream));
    return scoped.map(h => ({
      item: h.item,
      classSlug: h.classSlug,
      subject: h.subject,
      source: h.source ?? source,
      folderPath: h.folderPath,
    }));
  }, [classHits, activeStream, source]);
  const classSearch = useAdvancedFileSearch(rawClassFiles, classFilters, 90);

  const subjectItems = useMemo(
    () => (subject === MISC_LABEL ? miscItems ?? [] : subjectEntry?.items ?? []),
    [subject, miscItems, subjectEntry]
  );
  const editorFolders = subjectEntry?.editorFolders;
  const rawSubjectFiles = useMemo<RawSearchableFile[]>(() => {
    const loose: RawSearchableFile[] = subjectItems.map(item => ({
      item,
      classSlug,
      subject,
      source,
    }));
    const nested: RawSearchableFile[] = (editorFolders ?? []).flatMap(folder =>
      flattenFolderFilesWithPath(folder).map(({ item, folderPath }) => ({
        item,
        classSlug,
        subject,
        source,
        folderPath,
      }))
    );
    return [...loose, ...nested];
  }, [subjectItems, editorFolders, classSlug, subject, source]);
  const fileSearch = useAdvancedFileSearch(rawSubjectFiles, fileFilters, 50);

  const groups = groupItems(subjectItems);
  const editorFoldersGroup = subjectEntry?.editorFoldersGroup ?? 'General';
  const displayGroups = useMemo(() => {
    if (!editorFolders?.length) return groups;
    const hasMatch = groups.some(g => g.group.toLowerCase() === editorFoldersGroup.toLowerCase());
    return hasMatch ? groups : [{ group: editorFoldersGroup, items: [] }, ...groups];
  }, [groups, editorFolders, editorFoldersGroup]);
  const subjectDataReady = !!subject && loadedSubjectKey === subjectKey;

  const openEntry = useMemo(() => {
    if (!file || !subjectDataReady) return null;
    return findItemInSubject(subjectItems, editorFolders, file);
  }, [file, subjectDataReady, subjectItems, editorFolders]);
  const activeFile = openEntry?.item ?? null;
  const activeFolderScope = openEntry?.folderScope ?? null;

  useEffect(() => {
    if (!file || !subjectDataReady || openEntry) return;
    onFileChange?.(undefined, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onFileChange identity is host-owned
  }, [file, subjectDataReady, openEntry]);

  const openFile = (item: ResourceItem, opts?: { replace?: boolean }) => {
    onFileChange?.(item.id, opts);
  };
  const closeFile = () => {
    if (canGoBack) { goBack(); return; }
    onFileChange?.(undefined, { replace: true });
  };

  const disclaimer = source === 'community' ? (
    <div className="doxx-disclaimer">
      <div className="doxx-disclaimer-title"><MessageCircle size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: -2 }} />About community resources</div>
      <p><CommunityLinks variant="disclaimer" /></p>
      {sourceCredit && <p style={{ marginTop: 8 }}>{sourceCredit}</p>}
    </div>
  ) : <p className="library-note">{t('resources.note')}</p>;

  // Class picked but no indexed dataset for it yet -> "coming soon" state.
  if (currentClass && !hasDataset) {
    return <main className="container content-page">
      <BackLink to={sourcePath} search={{}} label={t('resources.backToClasses')} />
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{desc}</p>
      <p className="library-note">{currentClass.board} · Class {currentClass.grade}{subject ? ` · ${subject}` : ''}</p>
      <div className="empty-state"><BookOpen /><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      {source === 'community' && disclaimer}
    </main>;
  }

  // Dataset fetch failed
  if (currentClass && hasDataset && manifestError) {
    return <main className="container content-page">
      <BackLink to={sourcePath} search={{}} label={t('resources.backToClasses')} />
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      <div className="empty-state">
        <RefreshCw size={28} />
        <h3>{t('resources.loadError.title')}</h3>
        <p>{t('resources.loadError.text')}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>{t('resources.loadError.refresh')}</Button>
      </div>
    </main>;
  }

  // Dataset manifest loading
  if (currentClass && hasDataset && !manifest) {
    return <main className="container content-page">
      <BackLink to={sourcePath} search={{}} label={t('resources.backToClasses')} />
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      <div className="doxx-cards" aria-busy={manifestLoading}>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
      </div>
    </main>;
  }

  // Class + manifest present, no subject picked yet -> subject cards + class-wide advanced file search
  if (currentClass && manifest && !subject) {
    const manifestIsEmpty = !manifest.subjects.length && !manifest.miscCount;
    return <main className="container content-page">
      <BackLink to={sourcePath} search={{}} label={t('resources.backToClasses')} />
      <div className="content-header">
        <h1>{title}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {t('resources.chooseSubject')}</p>
      </div>

      {!manifestIsEmpty && (
        <AdvancedSearchBar
          filters={classFilters}
          onChange={setClassFilters}
          facets={classSearch.facets}
          totalCount={classSearch.enrichedItems.length}
          matchCount={classSearch.results.length}
          loading={classHitsLoading}
          error={classSearch.error}
          placeholder="Search filenames in this class (e.g. DAIS prelim, phy 2025 -solution)…"
          ariaLabel={t('resources.searchClass.label')}
          showSubjectFilter
          onActivateCorpus={() => setClassCorpusRequested(true)}
        />
      )}

      {!manifestIsEmpty && currentClass.board === 'ISC' && (
        <div className="resource-stream-tabs"><StreamTabs stream={activeStream} onChange={next => onStreamChange?.(next)} /></div>
      )}
      {!!subjectCards.length && !classSearch.isActive && (
        <p className="library-note resource-total-count">{subjectCards.reduce((sum, s) => sum + s.count, 0).toLocaleString()} {t('resources.filesLabel')} {t('resources.total')}</p>
      )}

      {classSearch.isActive ? (
        classHitsLoading && !classHits ? (
          <div className="resource-file-grid resource-search-results" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
          </div>
        ) : classSearch.results.length ? (
          classSearch.results.length > 60 ? (
            <VirtualFileGrid
              className="resource-file-grid-virtual resource-search-results"
              items={classSearch.results}
              minColumnWidth={210}
              rowHeight={208}
              renderItem={entry => (
                <HitFileCard
                  key={`${entry.subject}-${entry.item.id}`}
                  entry={entry}
                  sourcePath={sourcePath}
                  stream={stream}
                  highlightTerms={classSearch.highlightTerms}
                  matchMode={classFilters.matchMode}
                  rawQuery={classFilters.query}
                />
              )}
            />
          ) : (
            <div className="resource-file-grid resource-search-results">
              {classSearch.results.map(entry => (
                <HitFileCard
                  key={`${entry.subject}-${entry.item.id}`}
                  entry={entry}
                  sourcePath={sourcePath}
                  stream={stream}
                  highlightTerms={classSearch.highlightTerms}
                  matchMode={classFilters.matchMode}
                  rawQuery={classFilters.query}
                />
              ))}
            </div>
          )
        ) : (
          <div className="empty-state">
            <Search />
            <h3>{t('resources.searchClass.empty.title')}</h3>
            <p>Try broadening your filename terms, switching match mode, or clearing active filters.</p>
            <Button variant="outline" onClick={() => setClassFilters(createDefaultFilters())}>Reset filters</Button>
          </div>
        )
      ) : manifestIsEmpty ? (
        <div className="empty-state"><BookOpen /><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      ) : !subjectCards.length ? (
        <div className="empty-state"><BookOpen /><h3>{t('hub.empty.title')}</h3><p>{t('hub.empty.text')}</p></div>
      ) : (
        <div className="doxx-cards">
          {subjectCards.map(s => {
            const isMisc = s.subject === MISC_LABEL;
            const isFeatured = s.subject === 'Featured';
            const meta = findSubjectMeta(s.subject);
            const Icon = isMisc ? Folder : isFeatured ? Sparkles : meta?.icon ?? FileText;
            return (
              <Link key={s.subject} to={sourcePath} search={{ class: classSlug, subject: s.subject, stream }} className={`doxx-card${isMisc || isFeatured ? ' tone-rose' : meta ? ` tone-${meta.tone}` : ''}${isFeatured ? ' doxx-card-featured-glow' : ''}`}>
                <span className="subject-icon doxx-subject-icon"><Icon size={22} strokeWidth={1.6} /></span>
                <span className="doxx-card-title">{s.subject}</span>
                <span className="doxx-card-meta">{s.count} {t('resources.filesLabel')}</span>
              </Link>
            );
          })}
        </div>
      )}
      {source === 'community' && disclaimer}
    </main>;
  }

  // Subject picked -> file list + subject-wide advanced filename search & filters
  if (currentClass && manifest && subject) {
    if (subjectError) {
      return <main className="container content-page">
        <BackLink to={sourcePath} search={{ class: classSlug, stream }} label={t('hub.backToSubjects')} />
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
        <div className="empty-state">
          <RefreshCw size={28} />
          <h3>{t('resources.loadError.title')}</h3>
          <p>{t('resources.loadError.text')}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>{t('resources.loadError.refresh')}</Button>
        </div>
      </main>;
    }

    if (!subjectDataReady) {
      return <main className="container content-page">
        <BackLink to={sourcePath} search={{ class: classSlug, stream }} label={t('hub.backToSubjects')} />
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
        <div className="resource-file-grid" aria-busy={subjectLoading}>
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
        </div>
      </main>;
    }

    const sidebarGroups = activeFolderScope
      ? [{ group: activeFolderScope.name, items: activeFolderScope.children.filter((c): c is ResourceItem => !isFolderNode(c)) }]
      : groups;

    if (activeFile) {
      return <main className="container content-page">
        <button type="button" className="back-link" onClick={closeFile}><ArrowLeft size={15} /> {t('doxx.back')}</button>
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
        <ResourceWatch
          groups={sidebarGroups}
          active={activeFile}
          onSelect={item => openFile(item, { replace: true })}
          shareUrl={`${getSiteOrigin()}${sourcePath}?class=${encodeURIComponent(classSlug ?? '')}&subject=${encodeURIComponent(subject ?? '')}&file=${encodeURIComponent(activeFile.id)}`}
        />
        {source === 'community' && disclaimer}
      </main>;
    }

    return <main className="container content-page">
      <BackLink to={sourcePath} search={{ class: classSlug, stream }} label={t('hub.backToSubjects')} />
      <div className="content-header">
        <h1>{subject}<span className="text-primary">.</span></h1>
        <p className="page-intro">{currentClass.board} · Class {currentClass.grade} · {title}</p>
      </div>

      {rawSubjectFiles.length > 0 && (
        <AdvancedSearchBar
          filters={fileFilters}
          onChange={setFileFilters}
          facets={fileSearch.facets}
          totalCount={fileSearch.enrichedItems.length}
          matchCount={fileSearch.results.length}
          error={fileSearch.error}
          placeholder={`Filter ${rawSubjectFiles.length.toLocaleString()} ${subject} filenames (e.g. prelim 2025, "specimen", -solution)…`}
          ariaLabel={t('resources.searchFiles.label')}
          showGroupFilter
        />
      )}

      {!fileSearch.isActive && <ClassTrending classSlug={classSlug} subject={subject} />}
      {fileSearch.isActive ? (
        fileSearch.results.length ? (
          fileSearch.results.length > 60 ? (
            <VirtualFileGrid
              className="resource-file-grid-virtual resource-search-results"
              items={fileSearch.results}
              minColumnWidth={210}
              rowHeight={208}
              renderItem={entry => (
                <SearchFileCard
                  key={entry.item.id}
                  entry={entry}
                  highlightTerms={fileSearch.highlightTerms}
                  matchMode={fileFilters.matchMode}
                  rawQuery={fileFilters.query}
                  onClick={() => { openFile(entry.item); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                />
              )}
            />
          ) : (
            <div className="resource-file-grid resource-search-results">
              {fileSearch.results.map(entry => (
                <SearchFileCard
                  key={entry.item.id}
                  entry={entry}
                  highlightTerms={fileSearch.highlightTerms}
                  matchMode={fileFilters.matchMode}
                  rawQuery={fileFilters.query}
                  onClick={() => { openFile(entry.item); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                />
              ))}
            </div>
          )
        ) : (
          <div className="empty-state">
            <Search />
            <h3>{t('resources.searchFiles.empty.title')}</h3>
            <p>No files matched your filename query and active filters. Try relaxing a filter or switching to Smart mode.</p>
            <Button variant="outline" onClick={() => setFileFilters(createDefaultFilters())}>Reset filters</Button>
          </div>
        )
      ) : subjectItems.length || editorFolders?.length ? (
        displayGroups.map(section => (
          <GroupSection
            key={section.group}
            group={section.group}
            items={section.items}
            editorFolders={section.group.toLowerCase() === editorFoldersGroup.toLowerCase() ? editorFolders : undefined}
            onPick={item => {
              openFile(item);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        ))
      ) : (
        <div className="empty-state"><BookOpen /><h3>{t('resources.classNote.title')}</h3><p>{t('resources.classNote.text')}</p></div>
      )}
      {source === 'community' && disclaimer}
    </main>;
  }

  // Top-level source view (no class picked yet) -> source-wide advanced file search + class grid
  return <main className="container content-page">
    <BackLink to="/resources" search={{}} label={t('resources.backToSources')} />
    <div className="content-header">
      <h1>{title}<span className="text-primary">.</span></h1>
      <p className="page-intro">{desc}</p>
    </div>

    <AdvancedSearchBar
      filters={sourceFilters}
      onChange={setSourceFilters}
      facets={sourceSearch.facets}
      totalCount={sourceSearch.enrichedItems.length}
      matchCount={sourceSearch.results.length}
      loading={sourceHitsLoading}
      error={sourceSearch.error}
      placeholder={`Search all ${source === 'cisce' ? 'official CISCE' : 'community'} filenames across classes (e.g. physics 2025, sqp, -solution)…`}
      ariaLabel={t('resources.searchSource.label')}
      showClassFilter
      showSubjectFilter
      onActivateCorpus={() => setSourceCorpusRequested(true)}
    />

    {sourceSearch.isActive ? (
      sourceHitsLoading && !sourceHits ? (
        <div className="resource-file-grid resource-search-results" aria-busy="true">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="doxx-card doxx-card-skeleton" aria-hidden="true" />)}
        </div>
      ) : sourceSearch.results.length ? (
        sourceSearch.results.length > 60 ? (
          <VirtualFileGrid
            className="resource-file-grid-virtual resource-search-results"
            items={sourceSearch.results}
            minColumnWidth={210}
            rowHeight={208}
            renderItem={entry => {
              const cls = classes.find(c => c.slug === entry.classSlug);
              return (
                <HitFileCard
                  key={`${entry.classSlug}-${entry.subject}-${entry.item.id}`}
                  entry={entry}
                  sourcePath={sourcePath}
                  classLabel={cls ? `${cls.board} ${cls.grade}` : undefined}
                  highlightTerms={sourceSearch.highlightTerms}
                  matchMode={sourceFilters.matchMode}
                  rawQuery={sourceFilters.query}
                />
              );
            }}
          />
        ) : (
          <div className="resource-file-grid resource-search-results">
            {sourceSearch.results.map(entry => {
              const cls = classes.find(c => c.slug === entry.classSlug);
              return (
                <HitFileCard
                  key={`${entry.classSlug}-${entry.subject}-${entry.item.id}`}
                  entry={entry}
                  sourcePath={sourcePath}
                  classLabel={cls ? `${cls.board} ${cls.grade}` : undefined}
                  highlightTerms={sourceSearch.highlightTerms}
                  matchMode={sourceFilters.matchMode}
                  rawQuery={sourceFilters.query}
                />
              );
            })}
          </div>
        )
      ) : (
        <div className="empty-state">
          <Search />
          <h3>{t('resources.searchSource.empty.title')}</h3>
          <p>Try a different filename keyword, switch match mode, or reset your active filters.</p>
          <Button variant="outline" onClick={() => setSourceFilters(createDefaultFilters())}>Reset filters</Button>
        </div>
      )
    ) : (
      <div className="class-grid">
        {classes.map(c => (
          <Link key={c.slug} to={sourcePath} search={{ class: c.slug, subject }} className={`class-card tone-${c.tone}`}>
            <span className="subject-icon"><c.icon /></span>
            <h3>Class {c.grade}</h3>
            <span className="class-label">{c.label}</span>
            <div className="card-bottom">{t('class.browseSubjects')} <ArrowUpRight size={18} /></div>
          </Link>
        ))}
      </div>
    )}
    {disclaimer}
  </main>;
}
