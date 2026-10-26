import { useEffect } from 'react';
import { useT } from './prefs';

/** Per-route document title: "Action Center · AICTE Approval and Operations Compliance Platform" (follows the language). */
export function useTitle(title: string): void {
  const t = useT();
  useEffect(() => {
    document.title = `${title} · ${t.app.name}`;
  }, [title, t]);
}
