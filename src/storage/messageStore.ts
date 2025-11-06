type StoredMessage = {
    eventId: string
    channelId: string
    threadId?: string
    replyId?: string
    userId: string
    message: string
    createdAt: Date
    updatedAt?: Date
}

type SaveMessageInput = Omit<StoredMessage, 'updatedAt'>

type UpdateMessageInput = {
    eventId: string
    message: string
    editedAt: Date
}

type MessageQuery = {
    channelId: string
    start: Date
    threadId?: string
    limit?: number
}

type ChannelStore = {
    byId: Map<string, StoredMessage>
    orderedIds: string[]
}

const messagesByChannel = new Map<string, ChannelStore>()

function getChannelStore(channelId: string): ChannelStore {
    let channelStore = messagesByChannel.get(channelId)
    if (!channelStore) {
        channelStore = {
            byId: new Map(),
            orderedIds: [],
        }
        messagesByChannel.set(channelId, channelStore)
    }
    return channelStore
}

export function saveMessage(message: SaveMessageInput): void {
    const channelStore = getChannelStore(message.channelId)
    const existing = channelStore.byId.get(message.eventId)
    const stored: StoredMessage = {
        ...message,
        createdAt: new Date(message.createdAt),
    }

    channelStore.byId.set(message.eventId, stored)
    if (!existing) {
        insertOrdered(channelStore, stored)
    }
}

export function updateMessageContent(
    channelId: string,
    message: UpdateMessageInput,
): void {
    const channelStore = messagesByChannel.get(channelId)
    if (!channelStore) {
        return
    }
    const stored = channelStore.byId.get(message.eventId)
    if (!stored) {
        return
    }
    stored.message = message.message
    stored.updatedAt = new Date(message.editedAt)
}

export function removeMessage(channelId: string, eventId: string): void {
    const channelStore = messagesByChannel.get(channelId)
    if (!channelStore) {
        return
    }
    channelStore.byId.delete(eventId)
    removeFromOrdered(channelStore.orderedIds, eventId)
}

export function getMessages(query: MessageQuery): StoredMessage[] {
    const channelStore = messagesByChannel.get(query.channelId)
    if (!channelStore) {
        return []
    }

    const limit = query.limit ?? 400
    const startTime = query.start.getTime()
    const threadId = query.threadId

    const results: StoredMessage[] = []
    const originId = threadId

    const orderedIds = channelStore.orderedIds
    const startIndex = findFirstIndex(orderedIds, channelStore.byId, startTime)

    for (let i = startIndex; i < orderedIds.length; i++) {
        const stored = channelStore.byId.get(orderedIds[i])
        if (!stored) {
            continue
        }
        if (threadId && stored.threadId !== threadId && stored.eventId !== originId) {
            continue
        }
        results.push(cloneStoredMessage(stored))
        if (results.length >= limit) {
            break
        }
    }

    return results
}

export function getRecentMessages(params: {
    channelId: string
    threadId?: string
    limit?: number
}): StoredMessage[] {
    const channelStore = messagesByChannel.get(params.channelId)
    if (!channelStore) {
        return []
    }

    const limit = params.limit ?? 100
    const threadId = params.threadId
    const originId = threadId

    const matches: StoredMessage[] = []
    for (const id of channelStore.orderedIds) {
        const stored = channelStore.byId.get(id)
        if (!stored) {
            continue
        }
        if (threadId && stored.threadId !== threadId && stored.eventId !== originId) {
            continue
        }
        matches.push(cloneStoredMessage(stored))
    }

    if (matches.length > limit) {
        return matches.slice(matches.length - limit)
    }

    return matches
}

export function clearMessages(): void {
    messagesByChannel.clear()
}

export type { StoredMessage as PersistedMessage }

function insertOrdered(channelStore: ChannelStore, message: StoredMessage): void {
    const { orderedIds, byId } = channelStore
    const time = message.createdAt.getTime()
    let low = 0
    let high = orderedIds.length

    while (low < high) {
        const mid = Math.floor((low + high) / 2)
        const midStored = byId.get(orderedIds[mid])
        const midTime = midStored ? midStored.createdAt.getTime() : Number.NEGATIVE_INFINITY
        if (midTime <= time) {
            low = mid + 1
        } else {
            high = mid
        }
    }

    orderedIds.splice(low, 0, message.eventId)
}

function removeFromOrdered(list: string[], eventId: string): void {
    const index = list.findIndex((id) => id === eventId)
    if (index !== -1) {
        list.splice(index, 1)
    }
}

function findFirstIndex(ids: string[], store: Map<string, StoredMessage>, timestamp: number): number {
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

function cloneStoredMessage(message: StoredMessage): StoredMessage {
    return {
        ...message,
        createdAt: new Date(message.createdAt),
        updatedAt: message.updatedAt ? new Date(message.updatedAt) : undefined,
    }
}
