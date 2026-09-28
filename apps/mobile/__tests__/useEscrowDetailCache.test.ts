import { renderHook, act } from '@testing-library/react-native';
import { useEscrowDetailCache } from '../hooks/useEscrowDetailCache';
import * as escrowCache from '../services/cache/escrowCache';
import { isOnline } from '../utils/network';

jest.mock('../utils/network', () => ({
  isOnline: jest.fn(),
}));

jest.mock('../services/cache/escrowCache', () => ({
  cacheEscrowDetail: jest.fn(() => Promise.resolve()),
  getCachedEscrowDetail: jest.fn(() => Promise.resolve(null)),
}));

describe('useEscrowDetailCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isOnline as jest.Mock).mockResolvedValue(true);
    (escrowCache.getCachedEscrowDetail as jest.Mock).mockResolvedValue(null);
  });

  it('fetches and caches fresh data when online', async () => {
    const escrowId = 'escrow-123';
    const freshData = { id: escrowId, balance: '100' };
    const fetcher = jest.fn().mockResolvedValue(freshData);

    const { result } = renderHook(() => useEscrowDetailCache(escrowId, fetcher));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(escrowCache.cacheEscrowDetail).toHaveBeenCalledWith(escrowId, freshData);
    expect(result.current.data).toEqual(freshData);
    expect(result.current.loading).toBe(false);
    expect(result.current.offline).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('falls back to cached data when fetcher rejects', async () => {
    const escrowId = 'escrow-456';
    const cachedPayload = {
      updatedAt: Date.now() - 1000,
      data: { id: escrowId, balance: 'cached' },
    };
    (escrowCache.getCachedEscrowDetail as jest.Mock).mockResolvedValue(cachedPayload);

    const fetchError = new Error('Network request failed');
    const fetcher = jest.fn().mockRejectedValue(fetchError);

    const { result } = renderHook(() => useEscrowDetailCache(escrowId, fetcher));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(fetchError);
    expect(result.current.offline).toBe(true);
    expect(result.current.data).toEqual(cachedPayload.data);
  });

  it('falls back to cached data when fetcher rejects even without cached data', async () => {
    const escrowId = 'escrow-789';
    (escrowCache.getCachedEscrowDetail as jest.Mock).mockResolvedValue(null);

    const fetchError = new Error('500 Internal Server Error');
    const fetcher = jest.fn().mockRejectedValue(fetchError);

    const { result } = renderHook(() => useEscrowDetailCache(escrowId, fetcher));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(fetchError);
    expect(result.current.data).toBeNull();
  });

  it('uses cached data when offline', async () => {
    const escrowId = 'escrow-offline';
    (isOnline as jest.Mock).mockResolvedValue(false);

    const cachedPayload = {
      updatedAt: Date.now() - 1000,
      data: { id: escrowId, balance: 'offline-cached' },
    };
    (escrowCache.getCachedEscrowDetail as jest.Mock).mockResolvedValue(cachedPayload);

    const fetcher = jest.fn();

    const { result } = renderHook(() => useEscrowDetailCache(escrowId, fetcher));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.offline).toBe(true);
    expect(result.current.data).toEqual(cachedPayload.data);
    expect(result.current.loading).toBe(false);
  });

  it('never leaves loading true when fetcher rejects', async () => {
    const escrowId = 'escrow-timeout';
    const fetcher = jest.fn().mockRejectedValue(new Error('timeout'));

    const { result } = renderHook(() => useEscrowDetailCache(escrowId, fetcher));

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
  });
});