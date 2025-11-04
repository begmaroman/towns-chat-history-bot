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
    end: Date
    threadId?: string
    limit?: number
}

const messagesByChannel = new Map<string, Map<string, StoredMessage>>()

function getChannelStore(channelId: string): Map<string, StoredMessage> {
    let channelStore = messagesByChannel.get(channelId)
    if (!channelStore) {
        channelStore = new Map()
        messagesByChannel.set(channelId, channelStore)
    }
    return channelStore
}

export function saveMessage(message: SaveMessageInput): void {
    console.log("Saving message:", message.eventId, "in channel:", message.channelId)
    const channelStore = getChannelStore(message.channelId)
    channelStore.set(message.eventId, {
        ...message,
        createdAt: new Date(message.createdAt),
    })
}

export function updateMessageContent(
    channelId: string,
    message: UpdateMessageInput,
): void {
    const channelStore = messagesByChannel.get(channelId)
    if (!channelStore) {
        return
    }
    const stored = channelStore.get(message.eventId)
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
    channelStore.delete(eventId)
}

export function getMessages(query: MessageQuery): StoredMessage[] {
    const channelStore = messagesByChannel.get(query.channelId)
    if (!channelStore) {
        console.log("No messages found for channel:", query.channelId)
        return []
    }

    const limit = query.limit ?? 400
    const startTime = query.start.getTime()
    const endTime = query.end.getTime()
    const threadId = query.threadId

    const results: StoredMessage[] = []
    const originId = threadId

    for (const stored of channelStore.values()) {
        const created = stored.createdAt.getTime()
        if (created < startTime || created > endTime) {
            continue
        }
        if (threadId && stored.threadId !== threadId && stored.eventId !== originId) {
            continue
        }
        results.push(stored)
    }

    results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return results.slice(0, limit).map((stored) => ({
        ...stored,
        createdAt: new Date(stored.createdAt),
        updatedAt: stored.updatedAt ? new Date(stored.updatedAt) : undefined,
    }))
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

    const items: StoredMessage[] = []
    for (const stored of channelStore.values()) {
        if (threadId && stored.threadId !== threadId && stored.eventId !== originId) {
            continue
        }
        items.push({
            ...stored,
            createdAt: new Date(stored.createdAt),
            updatedAt: stored.updatedAt ? new Date(stored.updatedAt) : undefined,
        })
    }

    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

    return items.slice(Math.max(0, items.length - limit))
}

export function clearMessages(): void {
    messagesByChannel.clear()
}

export type { StoredMessage as PersistedMessage }
