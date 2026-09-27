import { renderHook, act } from '@testing-library/react-native';
import { useBiometricLock } from '../hooks/useBiometricLock';
import * as LocalAuthentication from 'expo-local-authentication';
import { getSecureItem, saveSecureItem } from '../utils/secureStore';

jest.mock('expo-local-authentication');
jest.mock('../utils/secureStore', () => ({
  getSecureItem: jest.fn(() => Promise.resolve('false')),
  saveSecureItem: jest.fn(() => Promise.resolve()),
}));

describe('useBiometricLock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getSecureItem as jest.Mock).mockResolvedValue('false');
  });

  it('should initialize correctly', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(true);

    const { result } = renderHook(() => useBiometricLock());
    await act(async () => {});

    expect(result.current.isSupported).toBe(true);
    expect(result.current.isEnrolled).toBe(true);
    expect(result.current.isEnabled).toBe(false);
  });

  it('forceDisableBiometric clears lock when authenticateAsync always fails and hardware is gone (#721)', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(false);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
    (LocalAuthentication.authenticateAsync as jest.Mock).mockResolvedValue({
      success: false,
      error: 'not_available',
    });
    (getSecureItem as jest.Mock).mockResolvedValue('true');

    const { result } = renderHook(() => useBiometricLock());
    await act(async () => {});

    let outcome: { success: boolean; method: string } | undefined;
    await act(async () => {
      outcome = await result.current.forceDisableBiometric();
    });

    expect(outcome?.success).toBe(true);
    expect(outcome?.method).toBe('forced');
    expect(saveSecureItem).toHaveBeenCalledWith('biometric_enabled', 'false');
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isUnlocked).toBe(true);
  });

  it('disableBiometric still works via forced path when not enrolled', async () => {
    (LocalAuthentication.hasHardwareAsync as jest.Mock).mockResolvedValue(true);
    (LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValue(false);
    (getSecureItem as jest.Mock).mockResolvedValue('true');

    const { result } = renderHook(() => useBiometricLock());
    await act(async () => {});

    let ok = false;
    await act(async () => {
      ok = await result.current.disableBiometric();
    });
    expect(ok).toBe(true);
    expect(saveSecureItem).toHaveBeenCalledWith('biometric_enabled', 'false');
  });
});
