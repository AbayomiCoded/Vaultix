/**
 * useEscrowWebSocket
 *
 * Subscribes to real-time escrow lifecycle events from the backend gateway
 * using the documented join/leave protocol.
 *
 * Protocol (see apps/backend/src/gateways/escrow.gateway.ts):
 *   - Join room:  emit `joinEscrow`  with a plain escrowId string
 *   - Leave room: emit `leaveEscrow` with a plain escrowId string
 *   - Join ack:   server emits `joinedEscrow` with { escrowId }
 *   - Subscription rejected: server emits `error` with { message }
 *
 * Server-emitted lifecycle events (all arrive with { escrowId, ...data, timestamp }):
 *   escrow:status_changed, escrow:funded, escrow:completed, escrow:cancelled,
 *   escrow:dispute_filed, escrow:dispute_resolved,
 *   escrow:milestone_released, escrow:party_joined,
 *   escrow:condition_fulfilled, escrow:condition_confirmed
 *
 * Fixes #663 — previously the hook emitted `escrow:join`/`escrow:leave` with
 * `{ id }` objects, which the gateway never handled (it expects `joinEscrow`/
 * `leaveEscrow` with a plain string). Milestone and condition events were also
 * never subscribed to. Reconnect handling and post-auth identity refresh are
 * included.
 */
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGlobalWebSocket } from "@/app/contexts/WebSocketContext";
import { toast } from "sonner";

interface UseEscrowWebSocketProps {
  escrowId?: string;
  /** @deprecated — kept for callers that still pass it; ignored internally */
  isSocketConnected?: boolean;
  setSocketConnected?: (connected: boolean) => void;
}

interface GatewayEventPayload {
  escrowId?: string;
  message?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export function useEscrowWebSocket({
  escrowId,
  setSocketConnected,
}: UseEscrowWebSocketProps = {}) {
  const queryClient = useQueryClient();
  const { socket, isConnected } = useGlobalWebSocket();

  // Track the escrowId we most recently joined so we can leave on cleanup or
  // re-join when the socket identity changes after auth rotation.
  const joinedEscrowRef = useRef<string | undefined>(undefined);

  // Propagate connection state to callers that request it.
  useEffect(() => {
    if (setSocketConnected) {
      setSocketConnected(isConnected);
    }

    if (isConnected) {
      // On (re)connect, invalidate all relevant query caches so the UI
      // reflects any updates that arrived while we were disconnected.
      if (escrowId) {
        queryClient.invalidateQueries({ queryKey: ["escrow", escrowId] });
      }
      queryClient.invalidateQueries({ queryKey: ["escrows"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
  }, [isConnected, setSocketConnected, escrowId, queryClient]);

  useEffect(() => {
    if (!socket || !isConnected) return;

    // ── Join the escrow room using the documented protocol ─────────────────
    // Gateway @SubscribeMessage('joinEscrow') expects a plain string escrowId,
    // NOT an object like { id }.  The old `escrow:join` event was never handled
    // by the gateway at all.
    if (escrowId) {
      socket.emit("joinEscrow", escrowId);
      joinedEscrowRef.current = escrowId;
    }

    // ── Subscription rejection handler ─────────────────────────────────────
    const handleSubscriptionError = (err: { message?: string }) => {
      toast.error(err.message || "Subscription to escrow updates was rejected.");
    };

    // ── Generic invalidation helper ────────────────────────────────────────
    const invalidateEscrowQueries = (eventEscrowId?: string) => {
      const targetId = eventEscrowId || escrowId;
      if (targetId) {
        queryClient.invalidateQueries({ queryKey: ["escrow", targetId] });
      }
      queryClient.invalidateQueries({ queryKey: ["escrows"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    };

    // ── Escrow status / lifecycle events ───────────────────────────────────
    const handleEscrowUpdate = (event: GatewayEventPayload) => {
      toast.info(event.message || "Escrow updated.");
      const targetId = event.escrowId || escrowId;
      invalidateEscrowQueries(targetId);

      // Optimistically apply any partial payload the server provides.
      if (event.payload && targetId) {
        queryClient.setQueryData(["escrow", targetId], (oldData: unknown) => {
          if (!oldData || typeof oldData !== "object") return oldData;
          return { ...(oldData as object), ...(event.payload as object) };
        });
      }
    };

    // ── Milestone events ───────────────────────────────────────────────────
    const handleMilestoneReleased = (event: GatewayEventPayload) => {
      toast.success(event.message || "Milestone released.");
      invalidateEscrowQueries(event.escrowId);
    };

    // ── Party / condition events ───────────────────────────────────────────
    const handlePartyOrConditionEvent = (event: GatewayEventPayload) => {
      toast.info(event.message || "Escrow updated.");
      invalidateEscrowQueries(event.escrowId);
    };

    // Register all lifecycle events emitted by the gateway
    socket.on("escrow:status_changed",    handleEscrowUpdate);
    socket.on("escrow:funded",            handleEscrowUpdate);
    socket.on("escrow:completed",         handleEscrowUpdate);
    socket.on("escrow:cancelled",         handleEscrowUpdate);
    socket.on("escrow:dispute_filed",     handleEscrowUpdate);
    socket.on("escrow:dispute_resolved",  handleEscrowUpdate);
    socket.on("escrow:milestone_released",handleMilestoneReleased);
    socket.on("escrow:party_joined",      handlePartyOrConditionEvent);
    socket.on("escrow:condition_fulfilled",handlePartyOrConditionEvent);
    socket.on("escrow:condition_confirmed",handlePartyOrConditionEvent);
    socket.on("error",                    handleSubscriptionError);

    return () => {
      // ── Leave the escrow room on unmount / dependency change ─────────────
      // Gateway @SubscribeMessage('leaveEscrow') also expects a plain string.
      if (joinedEscrowRef.current) {
        socket.emit("leaveEscrow", joinedEscrowRef.current);
        joinedEscrowRef.current = undefined;
      }

      socket.off("escrow:status_changed",    handleEscrowUpdate);
      socket.off("escrow:funded",            handleEscrowUpdate);
      socket.off("escrow:completed",         handleEscrowUpdate);
      socket.off("escrow:cancelled",         handleEscrowUpdate);
      socket.off("escrow:dispute_filed",     handleEscrowUpdate);
      socket.off("escrow:dispute_resolved",  handleEscrowUpdate);
      socket.off("escrow:milestone_released",handleMilestoneReleased);
      socket.off("escrow:party_joined",      handlePartyOrConditionEvent);
      socket.off("escrow:condition_fulfilled",handlePartyOrConditionEvent);
      socket.off("escrow:condition_confirmed",handlePartyOrConditionEvent);
      socket.off("error",                    handleSubscriptionError);
    };
  }, [socket, isConnected, escrowId, queryClient]);

  return { isConnected };
}
