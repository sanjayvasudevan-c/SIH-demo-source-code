import { useEffect, useState } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import { downloadBlob } from '../api/client';
import type { CaseDocument } from '../api/types';
import { cx, formatDate } from '../lib/format';
import { Badge, Card, EmptyState, ErrorState, Skeleton } from './ui';

export function DocumentViewer({ documents, title = 'Documents' }: { documents: CaseDocument[]; title?: string }) {
  const current = documents.filter((d) => d.current);
  const [selected, setSelected] = useState<string | null>(current[0]?.id ?? null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const doc = documents.find((d) => d.id === selected) ?? null;

  useEffect(() => {
    if (!doc) return;
    let revoked: string | null = null;
    setLoading(true);
    setError(null);
    downloadBlob(`/documents/${doc.id}/download`)
      .then((b) => {
        revoked = URL.createObjectURL(b);
        setUrl(revoked);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [doc?.id]);

  if (documents.length === 0) {
    return (
      <Card title={title}>
        <EmptyState message="No documents are attached." />
      </Card>
    );
  }

  return (
    <Card title={title}>
      <ul className="flex flex-col divide-y rounded-lg border">
        {current.map((d) => {
          const older = documents.filter((x) => x.kind === d.kind && !x.current);
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => setSelected(d.id)}
                aria-pressed={selected === d.id}
                className={cx('hit flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-subtle', selected === d.id && 'bg-accent-soft')}
              >
                {d.mimeType === 'application/pdf' ? <FileText size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-secondary" /> : <ImageIcon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-secondary" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{d.label}</span>
                  <span className="tnum block text-xs text-muted">
                    {d.fileName} · uploaded {formatDate(d.uploadedAt)}
                    {d.expiryDate ? ` · expires ${formatDate(d.expiryDate)}` : ''}
                    {older.length ? ` · replaces ${older.length} earlier ${older.length === 1 ? 'version' : 'versions'}` : ''}
                  </span>
                </span>
                {d.critical ? <Badge>Critical</Badge> : null}
                {d.verified ? <Badge tone="success">Verified</Badge> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 overflow-hidden rounded-lg border bg-page">
        {loading ? (
          <div className="p-4">
            <Skeleton lines={6} />
          </div>
        ) : error ? (
          <ErrorState message={error} />
        ) : doc && url ? (
          doc.mimeType === 'application/pdf' ? (
            <iframe title={`${doc.label} (${doc.fileName})`} src={url} className="h-table w-full bg-surface" />
          ) : (
            <img src={url} alt={`${doc.label} (${doc.fileName})`} className="mx-auto max-h-table" />
          )
        ) : null}
      </div>
    </Card>
  );
}
