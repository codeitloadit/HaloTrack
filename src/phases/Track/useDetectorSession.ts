import { useCallback, useEffect, useRef } from "react";
import { openSession, type AutoTrackSession } from "../../lib/autoTrackRunner";
import type { Project } from "../../state/types";

/**
 * One detector (and off-screen video) for the Track screen, opened on first
 * use and shared by everything that needs it there. Closed on leaving.
 */
export function useDetectorSession(project: Project | null): () => Promise<AutoTrackSession> {
  const sessionRef = useRef<Promise<AutoTrackSession> | null>(null);

  const acquire = useCallback(() => {
    if (!project) return Promise.reject(new Error("No video loaded"));
    if (!sessionRef.current) {
      const opening = openSession(project);
      sessionRef.current = opening;
      // Let a later call try again rather than keep handing out the failure.
      opening.catch(() => {
        if (sessionRef.current === opening) sessionRef.current = null;
      });
    }
    return sessionRef.current;
  }, [project]);

  useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      session?.then(
        (s) => s.close(),
        () => {},
      );
    },
    [project],
  );

  return acquire;
}
