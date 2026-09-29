import { useEffect, useState } from "react";

import {
  cacheEscrowDetail,
  getCachedEscrowDetail,
} from "../services/cache/escrowCache";

import { isOnline } from "../utils/network";

export function useEscrowDetailCache(
  escrowId: string,
  fetcher: () => Promise<unknown>
) {

  const [data, setData] =
    useState<unknown>(null);

  const [loading, setLoading] =
    useState(true);

  const [offline, setOffline] =
    useState(false);

  const [updatedAt, setUpdatedAt] =
    useState<number>();

  const [stale, setStale] =
    useState(false);

  const [error, setError] =
    useState<Error | null>(null);

  useEffect(() => {
    load();
  }, [escrowId]);

  async function load() {
    setLoading(true);
    setError(null);

    const online = await isOnline();

    if (!online) {
      setOffline(true);

      const cached =
        await getCachedEscrowDetail(
          escrowId
        );

      if (cached) {
        setData(cached.data);
        setUpdatedAt(cached.updatedAt);
        setStale(cached.stale);
      } else {
        setData(null);
        setUpdatedAt(undefined);
        setStale(false);
      }

      setLoading(false);
      return;
    }

    try {
      const fresh = await fetcher();

      await cacheEscrowDetail(
        escrowId,
        fresh
      );

      setData(fresh);

      setOffline(false);

      setUpdatedAt(Date.now());

      setStale(false);
    } catch (err) {
      const error =
        err instanceof Error
          ? err
          : new Error(String(err));

      setError(error);
      setOffline(true);

      const cached =
        await getCachedEscrowDetail(
          escrowId
        );

      if (cached) {
        setData(cached.data);
        setUpdatedAt(cached.updatedAt);

        const age =
          Date.now() - cached.updatedAt;

        setStale(age > 1000 * 60 * 30);
      }
    } finally {
      setLoading(false);
    }
  }

  return {
    data,
    loading,
    offline,
    error,
    updatedAt,
    stale,
    refresh: load,
  };
}
