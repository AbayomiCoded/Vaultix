export type Environment = 'dev' | 'testnet' | 'production';

export interface EnvConfig {
  environment: Environment;
  apiUrl: string;
  rpcUrl: string;
  /** Stellar network passphrase transactions are signed against (#709). */
  networkPassphrase: string;
}

const ENV: Environment = (process.env.EXPO_PUBLIC_APP_ENV as Environment) || 'dev';

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

const configs: Record<Environment, EnvConfig> = {
  dev: {
    environment: 'dev',
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000',
    rpcUrl: process.env.EXPO_PUBLIC_RPC_URL || 'http://localhost:8000/soroban/rpc',
    networkPassphrase: process.env.EXPO_PUBLIC_NETWORK_PASSPHRASE || TESTNET_PASSPHRASE,
  },
  testnet: {
    environment: 'testnet',
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api-testnet.vaultix.com',
    rpcUrl: process.env.EXPO_PUBLIC_RPC_URL || 'https://soroban-testnet.stellar.org',
    networkPassphrase: process.env.EXPO_PUBLIC_NETWORK_PASSPHRASE || TESTNET_PASSPHRASE,
  },
  production: {
    environment: 'production',
    apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://api.vaultix.com',
    rpcUrl: process.env.EXPO_PUBLIC_RPC_URL || 'https://rpc.vaultix.com',
    networkPassphrase: process.env.EXPO_PUBLIC_NETWORK_PASSPHRASE || PUBLIC_PASSPHRASE,
  },
};

export const envConfig = configs[ENV];

const DEFAULTS: Record<Environment, EnvConfig> = {
  dev: {
    environment: 'dev',
    apiUrl: 'http://localhost:3000',
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    networkPassphrase: TESTNET_PASSPHRASE,
  },
  testnet: {
    environment: 'testnet',
    apiUrl: 'https://api-testnet.vaultix.com',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    networkPassphrase: TESTNET_PASSPHRASE,
  },
  production: {
    environment: 'production',
    apiUrl: 'https://api.vaultix.com',
    rpcUrl: 'https://rpc.vaultix.com',
    networkPassphrase: PUBLIC_PASSPHRASE,
  },
};

export const validateEnv = (): string[] => {
  const missing: string[] = [];
  const warnings: string[] = [];

  if (!process.env.EXPO_PUBLIC_APP_ENV) {
    warnings.push('EXPO_PUBLIC_APP_ENV is not set — defaulting to "dev"');
  }

  if (!process.env.EXPO_PUBLIC_API_URL) {
    missing.push('EXPO_PUBLIC_API_URL');
  }

  if (!process.env.EXPO_PUBLIC_RPC_URL) {
    missing.push('EXPO_PUBLIC_RPC_URL');
  }

  if (missing.length > 0 || warnings.length > 0) {
    const defaultCfg = DEFAULTS[ENV];
    const lines: string[] = [
      `[envConfig] Environment: ${ENV}`,
    ];
    if (warnings.length) {
      lines.push('Warnings:');
      warnings.forEach((w) => lines.push(`  ⚠️  ${w}`));
    }
    if (missing.length) {
      lines.push('Using built-in defaults for:');
      missing.forEach((v) => {
        const fallback =
          v === 'EXPO_PUBLIC_API_URL' ? defaultCfg.apiUrl : defaultCfg.rpcUrl;
        lines.push(`  • ${v} → ${fallback}`);
      });
    }
    const message = lines.join('\n');
    console.warn(message);
    if (__DEV__) {
      setTimeout(() => {
        alert(`⚠️  Vaultix Configuration Notice\n\n${message}`);
      }, 500);
    }
  }

  return warnings.concat(
    missing.map((v) => `${v} missing — using env default (${ENV})`),
  );
};
