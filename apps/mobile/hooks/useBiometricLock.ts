import { useState, useEffect, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import { getSecureItem, saveSecureItem } from '../utils/secureStore';
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled';
/**
 * #762 — separate toggle for *re*-authenticating value-moving actions, so a
 * user can keep the app lock but not be prompted on every release, or vice
 * versa. Absent means "on whenever the app lock is on".
 */
const REAUTH_ENABLED_KEY = 'biometric_reauth_enabled';

export type BiometricAvailability =
  | 'available'
  | 'no_hardware'
  | 'not_enrolled'
  | 'unknown';

/** Why a re-authentication attempt did not succeed. */
export type ReauthFailureReason = 'cancelled' | 'unavailable' | 'error';

export interface ReauthRequest {
  /** What the user is authorising, e.g. "Confirm milestone release". */
  promptMessage: string;
  /** Which action / how much, shown under the prompt. */
  subtitle: string;
  cancelLabel?: string;
}

export interface ReauthResult {
  /** False when the requirement is off — the caller should just proceed. */
  required: boolean;
  success: boolean;
  reason?: ReauthFailureReason;
}

export const useBiometricLock = () => {
  const [isSupported, setIsSupported] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isEnabled, setIsEnabled] = useState(false);
  // Locked until proven otherwise: the SecureStore preference read resolves
  // after first paint, so defaulting to `true` rendered real content before
  // the lock screen could ever appear.
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [availability, setAvailability] =
    useState<BiometricAvailability>('unknown');
  // #762 — defaults to on whenever the app lock is on.
  const [reauthRequired, setReauthRequiredState] = useState(true);
  const [isReauthing, setIsReauthing] = useState(false);

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

  /**
   * #762 — read the re-auth preference, defaulting to "on" when the app lock is
   * on. Called with the freshly resolved lock state so a first-time enable picks
   * up the secure default rather than silently staying off.
   */
  const loadReauthPreference = useCallback(async (biometricEnabled: boolean) => {
    const stored = await getSecureItem(REAUTH_ENABLED_KEY);
    if (stored === null || stored === undefined) {
      setReauthRequiredState(biometricEnabled);
      if (biometricEnabled) await saveSecureItem(REAUTH_ENABLED_KEY, 'true');
      return;
    }
    setReauthRequiredState(stored === 'true');
  }, []);

  const loadBiometricPreference = useCallback(async () => {
    const preference = await getSecureItem(BIOMETRIC_ENABLED_KEY);
    const enabled = preference === 'true';
    setIsEnabled(enabled);
    if (enabled) {
      setIsUnlocked(false);
    } else {
      // No lock configured — proceed straight into the app.
      setIsUnlocked(true);
    }
    await loadReauthPreference(enabled);
  }, [loadReauthPreference]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      await refreshAvailability();
      await loadBiometricPreference();
      if (!cancelled) setIsInitializing(false);
    };
    void init();
    return () => {
      cancelled = true;
    };
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
      // #762 — turning the app lock on turns re-auth on too, unless the user
      // has previously made an explicit choice.
      await loadReauthPreference(true);
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

  /**
   * #762 — Settings toggle for requiring re-authentication before value-moving
   * actions. Persisted in SecureStore alongside the app-lock preference so it
   * survives restarts and is wiped with the rest of the session state.
   */
  const setReauthRequired = useCallback(async (required: boolean) => {
    // Re-auth without an app lock would be meaningless, and the OS would prompt
    // on every action with no way to disable it from Settings.
    if (!isEnabled && required) return false;
    await saveSecureItem(REAUTH_ENABLED_KEY, required ? 'true' : 'false');
    setReauthRequiredState(required);
    return true;
  }, [isEnabled]);

  /**
   * #762 — Gate a value-moving action behind a fresh biometric check.
   *
   * The app lock only protects launch and foreground resume, so an already
   * unlocked phone could previously release a milestone or create an escrow with
   * a plain button tap. Callers must treat `success: false` as "abort, change
   * nothing" — no request, no local state mutation.
   *
   * Returns `{ required: false }` when the requirement is off, so callers can
   * use the same code path either way.
   */
  const reauthenticate = useCallback(async (request: ReauthRequest): Promise<ReauthResult> => {
    if (!reauthRequired || !isEnabled) {
      return { required: false, success: true };
    }

    setIsReauthing(true);
    try {
      const { compatible, enrolled } = await refreshAvailability();
      if (!compatible || !enrolled) {
        return { required: true, success: false, reason: 'unavailable' };
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: request.promptMessage,
        subtitle: request.subtitle,
        cancelLabel: request.cancelLabel ?? 'Cancel',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false,
      });

      if (result.success) {
        return { required: true, success: true };
      }
      // `userCancel` is the usual path; treat any non-success as "do not proceed".
      return { required: true, success: false, reason: 'cancelled' };
    } catch {
      return { required: true, success: false, reason: 'error' };
    } finally {
      setIsReauthing(false);
    }
  }, [reauthRequired, isEnabled, refreshAvailability]);

  const biometricsUnavailableWhileLocked =
    isEnabled &&
    !isUnlocked &&
    (availability === 'no_hardware' || availability === 'not_enrolled');

  return {
    isSupported,
    isEnrolled,
    isEnabled,
    isUnlocked,
    isInitializing,
    availability,
    biometricsUnavailableWhileLocked,
    // #762
    reauthRequired,
    isReauthing,
    setReauthRequired,
    reauthenticate,
    enableBiometric,
    disableBiometric,
    forceDisableBiometric,
    authenticate,
    lock,
    refreshAvailability,
  };
};
