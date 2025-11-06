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
    earliestTimestamp?: number
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
    const stored = cloneInputMessage(message)

    channelStore.byId.set(message.eventId, stored)
    if (!existing) {
        insertOrdered(channelStore, stored)
    }
    updateEarliestTimestamp(channelStore, stored.createdAt.getTime())
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
    recomputeEarliestTimestamp(channelStore)
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

export function getEarliestTimestamp(channelId: string): number | undefined {
    const store = messagesByChannel.get(channelId)
    return store?.earliestTimestamp
}

export function bulkSaveMessages(channelId: string, messages: StoredMessage[]): void {
    if (!messages.length) {
        return
    }

    const channelStore = getChannelStore(channelId)
    messages
        .map(cloneInputMessage)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .forEach((message) => {
            if (channelStore.byId.has(message.eventId)) {
                return
            }
            channelStore.byId.set(message.eventId, message)
            insertOrdered(channelStore, message)
            updateEarliestTimestamp(channelStore, message.createdAt.getTime())
        })
}

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

function cloneInputMessage(message: SaveMessageInput | StoredMessage): StoredMessage {
    return {
        ...message,
        createdAt: new Date(message.createdAt),
        updatedAt: 'updatedAt' in message && message.updatedAt
            ? new Date(message.updatedAt)
            : undefined,
    }
}

function updateEarliestTimestamp(store: ChannelStore, timestamp: number): void {
    if (store.earliestTimestamp === undefined || timestamp < store.earliestTimestamp) {
        store.earliestTimestamp = timestamp
    }
}

function recomputeEarliestTimestamp(store: ChannelStore): void {
    const firstId = store.orderedIds[0]
    if (!firstId) {
        store.earliestTimestamp = undefined
        return
    }
    const message = store.byId.get(firstId)
    store.earliestTimestamp = message ? message.createdAt.getTime() : undefined
}
