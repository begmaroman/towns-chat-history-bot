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
    const channelStore = getChannelStore(message.channelId)
    channelStore.set(message.eventId, { ...message })
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
    stored.updatedAt = message.editedAt
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

export type { StoredMessage as PersistedMessage }
