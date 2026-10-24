import { useEffect } from "react";

/** Sets a descriptive page title per route (WCAG 2.4.2). */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · LabSentinel`;
  }, [title]);
}
