import type { PendingSummaryRequestRecord, SaveMessageInput, StoredMessage } from './types'

export function cloneStoredMessage(message: StoredMessage): StoredMessage {
    return {
        ...message,
        createdAt: new Date(message.createdAt),
        updatedAt: message.updatedAt ? new Date(message.updatedAt) : undefined,
    }
}

export function cloneInputMessage(message: SaveMessageInput | StoredMessage): StoredMessage {
    return {
        ...message,
        createdAt: new Date(message.createdAt),
        updatedAt: 'updatedAt' in message && message.updatedAt ? new Date(message.updatedAt) : undefined,
    }
}

export function clonePendingSummaryRequest(request: PendingSummaryRequestRecord): PendingSummaryRequestRecord {
    return {
        ...request,
        timeframe: {
            ...request.timeframe,
            start: new Date(request.timeframe.start),
        },
    }
}

export function findFirstIndex(
    ids: string[],
    store: Map<string, StoredMessage>,
    timestamp: number,
): number {
    let low = 0
    let high = ids.length

    while (low < high) {
        const mid = Math.floor((low + high) / 2)
        const midStored = store.get(ids[mid])
        const midTime = midStored ? midStored.createdAt.getTime() : Number.NEGATIVE_INFINITY
        if (midTime < timestamp) {
            low = mid + 1
        } else {
            high = mid
        }
    }

    return low
}
