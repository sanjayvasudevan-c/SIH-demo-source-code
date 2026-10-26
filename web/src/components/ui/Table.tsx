import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from '../../lib/format';
import { useT } from '../../lib/prefs';
import { EmptyState, ErrorState, Skeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  sortValue?: (row: T) => string | number | null;
  /** Plain-text value used for the truncation tooltip. */
  title?: (row: T) => string;
  className?: string;
  srOnlyHeader?: boolean;
  /** Let long text wrap instead of truncating with a tooltip. */
  wrap?: boolean;
}

export interface TableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowLabel?: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyMessage: string;
  emptyAction?: ReactNode;
  toolbar?: ReactNode;
  pageSize?: number;
  selectedKey?: string | null;
  expandedKey?: string | null;
  renderExpanded?: (row: T) => ReactNode;
}

/** Records are always tables: 44px rows, sticky header, numbers right-aligned, whole row clickable. */
export function Table<T>({ caption, columns, rows, rowKey, onRowClick, rowLabel, loading, error, onRetry, emptyMessage, emptyAction, toolbar, pageSize = 25, selectedKey, expandedKey, renderExpanded }: TableProps<T>) {
  const en = useT();
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!rows) return [];
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const val = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const r = x < y ? -1 : 1;
      return sort.dir === 'asc' ? r : -r;
    });
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages);
  const visible = sorted.slice((current - 1) * pageSize, current * pageSize);

  return (
    <div className="overflow-hidden rounded-lg border bg-surface">
      {toolbar ? <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">{toolbar}</div> : null}
      <div className="max-h-table overflow-auto" tabIndex={0} role="region" aria-label={caption}>
        <table className="w-full border-collapse text-base">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-subtle">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none';
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={c.sortValue ? ariaSort : undefined}
                    className={cx('h-row whitespace-nowrap px-4 text-xs font-semibold text-secondary', c.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    {c.srOnlyHeader ? (
                      <span className="sr-only">{c.header}</span>
                    ) : c.sortValue ? (
                      <button
                        type="button"
                        className={cx('hit inline-flex items-center gap-1 hover:text-primary', c.align === 'right' && 'flex-row-reverse')}
                        onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }))}
                      >
                        {c.header}
                        {active ? sort!.dir === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden /> : <ArrowUpDown size={12} aria-hidden className="text-muted" />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t">
                    {columns.map((c) => (
                      <td key={c.key} className="h-row px-4">
                        <Skeleton />
                      </td>
                    ))}
                  </tr>
                ))
              : visible.map((row) => {
                  const k = rowKey(row);
                  const clickable = !!onRowClick;
                  return (
                    <RowFragment key={k}>
                      <tr
                        tabIndex={clickable ? 0 : undefined}
                        aria-label={clickable && rowLabel ? rowLabel(row) : undefined}
                        onClick={clickable ? () => onRowClick!(row) : undefined}
                        onKeyDown={
                          clickable
                            ? (e) => {
                                if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick!(row);
                              }
                            : undefined
                        }
                        className={cx(
                          'border-t transition-colors duration-150 ease-out',
                          clickable && 'cursor-pointer hover:bg-subtle focus-visible:bg-accent-soft',
                          selectedKey === k && 'bg-accent-soft',
                        )}
                      >
                        {columns.map((c) => (
                          <td
                            key={c.key}
                            title={c.title ? c.title(row) : undefined}
                            className={cx('h-row px-4', c.wrap ? 'max-w-md py-2' : 'max-w-xs truncate', c.align === 'right' ? 'tnum text-right' : 'text-left', c.className)}
                          >
                            {c.render(row)}
                          </td>
                        ))}
                      </tr>
                      {expandedKey === k && renderExpanded ? (
                        <tr className="border-t bg-page">
                          <td colSpan={columns.length} className="px-4 py-4">
                            {renderExpanded(row)}
                          </td>
                        </tr>
                      ) : null}
                    </RowFragment>
                  );
                })}
          </tbody>
        </table>
        {!loading && error ? <ErrorState message={error} onRetry={onRetry} /> : null}
        {!loading && !error && rows && rows.length === 0 ? <EmptyState message={emptyMessage} action={emptyAction} /> : null}
      </div>
      {!loading && !error && sorted.length > pageSize ? (
        <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-secondary">
          <span className="tnum">{en.common.rows(sorted.length)}</span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label={en.common.previous} disabled={current <= 1} onClick={() => setPage(current - 1)} className="hit inline-flex h-control-sm w-control-sm items-center justify-center rounded hover:bg-subtle disabled:opacity-50">
              <ChevronLeft size={16} aria-hidden />
            </button>
            <span className="tnum">{en.common.page(current, pages)}</span>
            <button type="button" aria-label={en.common.next} disabled={current >= pages} onClick={() => setPage(current + 1)} className="hit inline-flex h-control-sm w-control-sm items-center justify-center rounded hover:bg-subtle disabled:opacity-50">
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RowFragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
