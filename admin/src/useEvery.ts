import { useEffect } from 'react';

/** Runs `fn` every `ms` while the tab is visible (no polling in the background). */
export function useEvery(fn: () => void, ms: number) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fn();
      }
    }, ms);
    return () => clearInterval(timer);
  }, [fn, ms]);
}
