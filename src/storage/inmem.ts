import { MESSAGE_RETENTION_MS, STORAGE_PRUNE_INTERVAL_MS } from './constants'
import { cloneInputMessage, cloneStoredMessage, findFirstIndex } from './utils'
import type {
    ChannelStore,
    MessageQuery,
    MessageStorage,
    SaveMessageInput,
    StoredMessage,
    UpdateMessageInput,
} from './types'

export class InMemoryMessageStorage implements MessageStorage {
    private readonly messagesByChannel = new Map<string, ChannelStore>()
    private readonly lastPruneCheck = new Map<string, number>()

    async saveMessage(message: SaveMessageInput): Promise<void> {
        const channelStore = this.getChannelStore(message.channelId)
        const existing = channelStore.byId.get(message.eventId)
        const stored = cloneInputMessage(message)

        channelStore.byId.set(message.eventId, stored)
        if (!existing) {
            this.insertOrdered(channelStore, stored)
        }
        this.updateEarliestTimestamp(channelStore, stored.createdAt.getTime())
        this.maybePruneChannel(message.channelId)
    }

    async updateMessageContent(channelId: string, message: UpdateMessageInput): Promise<void> {
        const channelStore = this.messagesByChannel.get(channelId)
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

    async removeMessage(channelId: string, eventId: string): Promise<void> {
        const channelStore = this.messagesByChannel.get(channelId)
        if (!channelStore) {
            return
        }
        channelStore.byId.delete(eventId)
        this.removeFromOrdered(channelStore, eventId)
        this.recomputeEarliestTimestamp(channelStore)
        this.maybePruneChannel(channelId)
    }

    async getMessages(query: MessageQuery): Promise<StoredMessage[]> {
        const channelStore = this.messagesByChannel.get(query.channelId)
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

    async getRecentMessages(params: { channelId: string; threadId?: string; limit?: number }): Promise<StoredMessage[]> {
        const channelStore = this.messagesByChannel.get(params.channelId)
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

    async getEarliestTimestamp(channelId: string): Promise<number | undefined> {
        const store = this.messagesByChannel.get(channelId)
        return store?.earliestTimestamp
    }

    async bulkSaveMessages(channelId: string, messages: StoredMessage[]): Promise<void> {
        if (!messages.length) {
            return
        }

        const channelStore = this.getChannelStore(channelId)
        messages
            .map(cloneInputMessage)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .forEach((message) => {
                if (channelStore.byId.has(message.eventId)) {
                    return
                }
                channelStore.byId.set(message.eventId, message)
                this.insertOrdered(channelStore, message)
                this.updateEarliestTimestamp(channelStore, message.createdAt.getTime())
            })
        this.maybePruneChannel(channelId)
    }

    private insertOrdered(channelStore: ChannelStore, message: StoredMessage): void {
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

    private removeFromOrdered(channelStore: ChannelStore, eventId: string): void {
        const index = channelStore.orderedIds.findIndex((id) => id === eventId)
        if (index !== -1) {
            channelStore.orderedIds.splice(index, 1)
        }
    }

    private updateEarliestTimestamp(store: ChannelStore, timestamp: number): void {
        if (store.earliestTimestamp === undefined || timestamp < store.earliestTimestamp) {
            store.earliestTimestamp = timestamp
        }
    }

    private recomputeEarliestTimestamp(store: ChannelStore): void {
        const firstId = store.orderedIds[0]
        if (!firstId) {
            store.earliestTimestamp = undefined
            return
        }
        const message = store.byId.get(firstId)
        store.earliestTimestamp = message ? message.createdAt.getTime() : undefined
    }

    private getChannelStore(channelId: string): ChannelStore {
        let channelStore = this.messagesByChannel.get(channelId)
        if (!channelStore) {
            channelStore = {
                byId: new Map(),
                orderedIds: [],
            }
            this.messagesByChannel.set(channelId, channelStore)
        }
        return channelStore
    }

    private maybePruneChannel(channelId: string): void {
        const now = Date.now()
        const last = this.lastPruneCheck.get(channelId) ?? 0
        if (now - last < STORAGE_PRUNE_INTERVAL_MS) {
            return
        }
        this.lastPruneCheck.set(channelId, now)
        const cutoffMs = now - MESSAGE_RETENTION_MS
        const channelStore = this.messagesByChannel.get(channelId)
        if (!channelStore) {
            return
        }
        let changed = false
        while (channelStore.orderedIds.length) {
            const firstId = channelStore.orderedIds[0]
            const message = firstId ? channelStore.byId.get(firstId) : undefined
            if (!firstId || !message) {
                channelStore.orderedIds.shift()
                continue
            }
            if (message.createdAt.getTime() >= cutoffMs) {
                break
            }
            channelStore.byId.delete(firstId)
            channelStore.orderedIds.shift()
            changed = true
        }
        if (changed) {
            this.recomputeEarliestTimestamp(channelStore)
        }
    }
}

export type { MessageStorage as MessageStore }
