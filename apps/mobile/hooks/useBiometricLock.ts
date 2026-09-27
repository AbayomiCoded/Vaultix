import { useState, useEffect, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { getSecureItem, saveSecureItem } from '../utils/secureStore';

const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';

export type BiometricAvailability =
  | 'available'
  | 'no_hardware'
  | 'not_enrolled'
  | 'unknown';

export const useBiometricLock = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(true);
  const [availability, setAvailability] =
    useState<BiometricAvailability>('unknown');

  const refreshAvailability = useCallback(async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setIsSupported(compatible);
    setIsEnrolled(enrolled);
    if (!compatible) setAvailability('no_hardware');
    else if (!enrolled) setAvailability('not_enrolled');
    else setAvailability('available');
    return { compatible, enrolled };
  }, []);

  const loadBiometricPreference = useCallback(async () => {
    const preference = await getSecureItem(BIOMETRIC_ENABLED_KEY);
    if (preference === 'true') {
      setIsEnabled(true);
      setIsUnlocked(false);
    }
  }, []);

  useEffect(() => {
    void refreshAvailability();
    void loadBiometricPreference();
  }, [refreshAvailability, loadBiometricPreference]);

  const enableBiometric = async () => {
    const { compatible, enrolled } = await refreshAvailability();
    if (!compatible || !enrolled) return false;

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to enable biometric lock',
      fallbackLabel: 'Use Passcode',
    });

    if (result.success) {
      await saveSecureItem(BIOMETRIC_ENABLED_KEY, 'true');
      setIsEnabled(true);
      return true;
    }
    return false;
  };

  /**
   * Preferred path: confirm with biometrics (or device passcode via OS fallback).
   */
  const disableBiometric = async () => {
    const { compatible, enrolled } = await refreshAvailability();
    if (compatible && enrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to disable biometric lock',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });
      if (!result.success) return false;
    }
    // If hardware is gone / not enrolled, skip biometric and clear preference (#721).
    await saveSecureItem(BIOMETRIC_ENABLED_KEY, 'false');
    setIsEnabled(false);
    setIsUnlocked(true);
    return true;
  };

  /**
   * Explicit recovery when biometrics cannot succeed (#721).
   * Uses the device passcode path when possible; if hardware reports
   * unavailable, clears the preference without a biometric read.
   */
  const forceDisableBiometric = async (opts?: {
    /** When true, still try device-passcode fallback before clearing. */
    preferDevicePasscode?: boolean;
  }): Promise<{ success: boolean; method: 'biometric' | 'passcode' | 'forced' }> => {
    const { compatible, enrolled } = await refreshAvailability();

    if (compatible && enrolled && opts?.preferDevicePasscode !== false) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm with device passcode to disable biometric lock',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });
      if (result.success) {
        await saveSecureItem(BIOMETRIC_ENABLED_KEY, 'false');
        setIsEnabled(false);
        setIsUnlocked(true);
        return { success: true, method: 'passcode' };
      }
      // User cancelled passcode — do not force-clear.
      if (compatible && enrolled) {
        return { success: false, method: 'passcode' };
      }
    }

    // Hardware unavailable or not enrolled: allow recovery without biometrics.
    await saveSecureItem(BIOMETRIC_ENABLED_KEY, 'false');
    setIsEnabled(false);
    setIsUnlocked(true);
    return { success: true, method: 'forced' };
  };

  const authenticate = async () => {
    if (!isEnabled) {
      setIsUnlocked(true);
      return true;
    }

    const { compatible, enrolled } = await refreshAvailability();
    if (!compatible || !enrolled) {
      // Cannot unlock via biometrics — caller should show recovery UI.
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Vaultix',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    if (result.success) {
      setIsUnlocked(true);
      return true;
    }
    return false;
  };

  const lock = () => {
    if (isEnabled) {
      setIsUnlocked(false);
    }
  };

  const biometricsUnavailableWhileLocked =
    isEnabled &&
    !isUnlocked &&
    (availability === 'no_hardware' || availability === 'not_enrolled');

  return {
    isSupported,
    isEnrolled,
    isEnabled,
    isUnlocked,
    availability,
    biometricsUnavailableWhileLocked,
    enableBiometric,
    disableBiometric,
    forceDisableBiometric,
    authenticate,
    lock,
    refreshAvailability,
  };
};
