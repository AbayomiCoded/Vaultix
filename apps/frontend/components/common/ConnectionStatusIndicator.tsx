'use client';

import React from 'react';
import { Wifi, WifiOff, RotateCw } from 'lucide-react';
import { useWebSocket } from '@/app/contexts/WebSocketContext';

const STATUS_CONFIG = {
  connected: {
    label: 'Live updates connected',
    icon: Wifi,
    dotClassName: 'bg-emerald-500',
    textClassName: 'text-emerald-600 dark:text-emerald-400',
  },
  reconnecting: {
    label: 'Reconnecting to live updates…',
    icon: RotateCw,
    dotClassName: 'bg-amber-500',
    textClassName: 'text-amber-600 dark:text-amber-400',
  },
  disconnected: {
    label: 'Live updates disconnected',
    icon: WifiOff,
    dotClassName: 'bg-gray-400 dark:bg-gray-600',
    textClassName: 'text-gray-500 dark:text-gray-400',
  },
} as const;

interface ConnectionStatusIndicatorProps {
  /** Show the text label next to the dot. Defaults to icon+dot only. */
  showLabel?: boolean;
  className?: string;
}

/** Small connected/reconnecting/disconnected indicator for the WebSocket link. */
export default function ConnectionStatusIndicator({
  showLabel = false,
  className = '',
}: ConnectionStatusIndicatorProps) {
  const { connectionStatus } = useWebSocket();
  const config = STATUS_CONFIG[connectionStatus];
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className}`}
      role="status"
      aria-label={config.label}
      title={config.label}
    >
      <span className="relative flex h-2 w-2">
        {connectionStatus === 'reconnecting' && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${config.dotClassName}`}
          />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${config.dotClassName}`}
        />
      </span>
      <Icon
        size={14}
        className={`${config.textClassName} ${connectionStatus === 'reconnecting' ? 'animate-spin' : ''}`}
      />
      {showLabel && (
        <span className={`text-xs font-medium ${config.textClassName}`}>
          {config.label}
        </span>
      )}
    </span>
  );
}
