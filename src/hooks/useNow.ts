import { useEffect, useState } from 'react';

/**
 * Re-renders on an interval so relative-time labels ("in 5 minutes") tick down instead of
 * freezing at first render. Mount this in the LEAF component that shows the time — never at the
 * app root, or the whole tree re-renders every tick. The default 20 s cadence is plenty for the
 * minute-granular countdowns we render (`formatRelative` rounds to whole minutes).
 */
export function useNow(intervalMs = 20_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
