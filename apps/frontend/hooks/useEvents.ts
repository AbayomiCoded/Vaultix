import { useEffect } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { IEscrowEventResponse } from '@/types/escrow';
import { EscrowService } from '@/services/escrow';
import { useWebSocket } from '@/app/contexts/WebSocketContext';

interface UseEventsParams {
    escrowId?: string;
    eventType?: string;
    limit?: number;
    refetchInterval?: number | false;
}

export const useEvents = (params: UseEventsParams = {}) => {
    const queryClient = useQueryClient();
    const { socket, isConnected } = useWebSocket();
    const query = useInfiniteQuery<IEscrowEventResponse>({
        queryKey: ['events', params],
        queryFn: async ({ pageParam = 1 }) => {
            // We will need to implement getEvents in EscrowService
            const response = await EscrowService.getEvents({
                ...params,
                page: pageParam as number,
            });
            return response;
        },
        getNextPageParam: (lastPage, pages) => {
            return lastPage.hasNextPage ? pages.length + 1 : undefined;
        },
        initialPageParam: 1,
        refetchInterval: params.refetchInterval ?? false,
    });

    useEffect(() => {
        const escrowId = params.escrowId;
        if (!escrowId || !socket || !isConnected) return;

        const cursorKey = `vaultix:events:${escrowId}`;
        const handleEvent = (event: { cursor?: string }) => {
            if (typeof event.cursor === 'string') {
                window.localStorage.setItem(cursorKey, event.cursor);
            }
            void queryClient.invalidateQueries({ queryKey: ['events', params] });
        };

        socket.on('escrow.event', handleEvent);
        socket.emit('joinEscrow', {
            escrowId,
            afterCursor: window.localStorage.getItem(cursorKey) ?? undefined,
        });

        return () => {
            socket.off('escrow.event', handleEvent);
            socket.emit('leaveEscrow', escrowId);
        };
    }, [params.escrowId, socket, isConnected, queryClient]);

    return query;
};
