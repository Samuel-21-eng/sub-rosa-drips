import { useState, useEffect, useCallback } from 'react';
import { useSubRosa } from './context';

export interface RoundState<T> {
  data: T | null;
  isLoading: boolean;
  isStale: boolean;
  isEmpty: boolean;
  error: Error | null;
}

export function useRoundState<T>(
  roundId: string,
  fetcher: (config: { rpcUrl: string; networkPassphrase: string }, roundId: string) => Promise<T>,
  enabled: boolean = true
): RoundState<T> {
  const { config, requestCache } = useSubRosa();
  const [state, setState] = useState<RoundState<T>>({
    data: null,
    isLoading: enabled,
    isStale: false,
    isEmpty: true,
    error: null,
  });

  const isTerminal = (data: T | null): boolean => {
    if (!data) return false;
    const status = (data as any).status;
    return status === 'Finalized' || status === 'Aborted';
  };

  const fetchData = useCallback(async () => {
    if (!enabled) return false;

    const cacheKey = `${roundId}`;
    let promise = requestCache.current.get(cacheKey);

    if (!promise) {
      promise = fetcher(config, roundId);
      requestCache.current.set(cacheKey, promise);
    }

    try {
      const data = await promise;
      setState({
        data,
        isLoading: false,
        isStale: false,
        isEmpty: !data,
        error: null,
      });
      return isTerminal(data);
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error : new Error('Unknown error'),
      }));
      return true; // Stop polling on error
    } finally {
      requestCache.current.delete(cacheKey);
    }
  }, [config, enabled, fetcher, requestCache, roundId]);

  useEffect(() => {
    if (!enabled) return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const stopped = await fetchData();
      if (!stopped) {
        timeoutId = setTimeout(poll, 5000); // Poll every 5 seconds
      }
    };

    poll();

    return () => {
      clearTimeout(timeoutId);
    };
  }, [fetchData, enabled]);

  return state;
}
