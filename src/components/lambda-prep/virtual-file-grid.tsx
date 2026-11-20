import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useRef, useState } from 'react';

/**
 * Windowed grid renderer for large file lists (hundreds to thousands of
 * items). Only mounts the rows currently in/near the viewport instead of
 * every FileCard at once — the DOM-node count stays flat regardless of how
 * many files a subject/search result has.
 *
 * Column count is derived from the container's width (matching the CSS
 * grid's `repeat(auto-fill, minmax(180px, 1fr))` sizing) via ResizeObserver,
 * so the virtualization math stays in sync with the actual layout at any
 * viewport size.
 *
 * Two scroll modes: by default the grid is its own capped scroll container
 * (right for a browser panel embedded in a fixed-height page), and
 * `windowScroll` virtualizes against the document instead, so a long result
 * list scrolls like normal page content rather than trapping the wheel in a
 * nested scroller.
 */
export function VirtualFileGrid<T>({
  items,
  renderItem,
  minColumnWidth = 180,
  // Must cover the tallest .resource-file-card: 44px icon + 16px icon-name
  // gap + up to 3 wrapped lines of a 14px/1.35 name + 16px name-type gap +
  // ~16.5px type label + 2*16px padding + 2px border ≈ 171px. Rows are
  // absolutely positioned at a fixed height (no dynamic remeasurement), so
  // undersizing this causes adjacent rows to overlap and clip card text.
  rowHeight = 172,
  gap = 12,
  maxHeight = 600,
  windowScroll = false,
  className,
}: {
  items: readonly T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  minColumnWidth?: number;
  rowHeight?: number;
  gap?: number;
  maxHeight?: number;
  windowScroll?: boolean;
  className?: string;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth;
      const next = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
      setColumns(next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [minColumnWidth, gap]);

  const rowCount = Math.ceil(items.length / columns);

  // Window mode needs the list's offset from the top of the document so rows
  // can be translated into page coordinates. Re-measure whenever the row or
  // column count changes, since that is what moves the list below the search
  // bar and filter panel.
  useEffect(() => {
    if (!windowScroll) return;
    const el = parentRef.current;
    if (!el) return;
    setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
  }, [windowScroll, rowCount, columns]);

  const elementVirtualizer = useVirtualizer({
    count: windowScroll ? 0 : rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight + gap,
    overscan: 4,
  });

  const windowVirtualizer = useWindowVirtualizer({
    count: windowScroll ? rowCount : 0,
    estimateSize: () => rowHeight + gap,
    overscan: 6,
    scrollMargin,
  });

  const virtualizer = windowScroll ? windowVirtualizer : elementVirtualizer;
  const offset = windowScroll ? scrollMargin : 0;

  return (
    <div
      ref={parentRef}
      className={className}
      style={windowScroll ? undefined : { height: maxHeight, overflow: 'auto' }}
    >
      <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
        {virtualizer.getVirtualItems().map(row => {
          const start = row.index * columns;
          const rowItems = items.slice(start, start + columns);
          return (
            <div
              key={row.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                // Row stride (row.size) is rowHeight + gap so rows land at the
                // right vertical offsets, but the row element itself must only
                // be rowHeight tall — otherwise its CSS-grid children stretch
                // to fill the full stride (grid's default align-items:
                // stretch) and swallow the gap, leaving cards touching
                // top-to-bottom with no visible border between rows.
                height: rowHeight,
                transform: `translateY(${row.start - offset}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap,
              }}
            >
              {rowItems.map((item, i) => renderItem(item, start + i))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
