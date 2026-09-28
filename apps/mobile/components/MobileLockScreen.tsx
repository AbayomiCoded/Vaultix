import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { BiometricAvailability } from '../hooks/useBiometricLock';
import { colors } from '../theme';

interface MobileLockScreenProps {
  onUnlock: () => void;
  onDisableFallback: () => void;
  /** When biometrics hardware/enrollment is gone while lock is on (#721). */
  biometricsUnavailable?: boolean;
  availability?: BiometricAvailability;
}

export const MobileLockScreen: React.FC<MobileLockScreenProps> = ({
  onUnlock,
  onDisableFallback,
  biometricsUnavailable = false,
  availability = 'unknown',
}) => {
  const unavailableMessage =
    availability === 'no_hardware'
      ? 'Biometric hardware is unavailable on this device.'
      : availability === 'not_enrolled'
        ? 'No biometrics are enrolled. Add a fingerprint or face in system settings, or recover below.'
        : 'Biometric unlock is currently unavailable.';

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <Text style={styles.icon}>🔒</Text>
      </View>
      <Text style={styles.title}>App Locked</Text>
      <Text style={styles.subtitle}>
        {biometricsUnavailable
          ? unavailableMessage
          : 'Unlock to access your secure Vaultix session.'}
      </Text>

      {!biometricsUnavailable && (
        <TouchableOpacity style={styles.unlockButton} onPress={onUnlock}>
          <Text style={styles.unlockButtonText}>Unlock with Biometrics</Text>
        </TouchableOpacity>
      )}

      {biometricsUnavailable ? (
        <>
          <Text style={styles.recoveryHint}>
            You can disable biometric lock using your device passcode, or force
            recovery if the sensor cannot be used. This does not delete your
            wallet — only turns off the lock screen.
          </Text>
          <TouchableOpacity style={styles.unlockButton} onPress={onDisableFallback}>
            <Text style={styles.unlockButtonText}>Recover — Disable Lock</Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity style={styles.fallbackButton} onPress={onDisableFallback}>
          <Text style={styles.fallbackButtonText}>Disable Biometric Lock</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 24,
  },
  iconContainer: {
    marginBottom: 24,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  recoveryHint: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  unlockButton: {
    backgroundColor: colors.infoStrong,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  unlockButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  fallbackButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
  },
  fallbackButtonText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
});
