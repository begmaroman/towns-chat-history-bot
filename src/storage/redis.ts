import { createClient, type RedisClientType } from 'redis'

import type {
    MessageQuery,
    MessageStorage,
    SaveMessageInput,
    StoredMessage,
    UpdateMessageInput,
} from './types'
import { cloneInputMessage, cloneStoredMessage } from './utils'

const CHANNEL_INDEX_KEY = 'message-store:channels'
const DEFAULT_BATCH_SIZE = 200

export class RedisMessageStorage implements MessageStorage {
    private readonly client: RedisClientType
    private readonly ready: Promise<void>

    constructor(url: string) {
        this.client = createClient({ url })
        this.client.on('error', (error) => {
            console.error('[redis-storage] connection error', error)
        })
        this.ready = this.client.connect()
    }

    private async ensureReady(): Promise<void> {
        if (!this.client.isOpen) {
            await this.ready
        }
    }

    async saveMessage(message: SaveMessageInput): Promise<void> {
        await this.ensureReady()
        const stored = cloneInputMessage(message)
        const payload = serializeMessage(stored)
        const pipeline = this.client.multi()
        pipeline.set(this.eventKey(message.channelId, message.eventId), payload)
        pipeline.zAdd(this.orderKey(message.channelId), [{ score: stored.createdAt.getTime(), value: stored.eventId }])
        pipeline.sAdd(this.eventsSetKey(message.channelId), stored.eventId)
        pipeline.sAdd(CHANNEL_INDEX_KEY, message.channelId)
        await pipeline.exec()
    }

    async updateMessageContent(channelId: string, message: UpdateMessageInput): Promise<void> {
        await this.ensureReady()
        const eventKey = this.eventKey(channelId, message.eventId)
        const raw = await this.client.get(eventKey)
        if (!raw) {
            return
        }
        const stored = deserializeMessage(raw)
        stored.message = message.message
        stored.updatedAt = new Date(message.editedAt)
        await this.client.set(eventKey, serializeMessage(stored))
    }

    async removeMessage(channelId: string, eventId: string): Promise<void> {
        await this.ensureReady()
        const pipeline = this.client.multi()
        pipeline.del(this.eventKey(channelId, eventId))
        pipeline.zRem(this.orderKey(channelId), eventId)
        pipeline.sRem(this.eventsSetKey(channelId), eventId)
        await pipeline.exec()
    }

    async getMessages(query: MessageQuery): Promise<StoredMessage[]> {
        await this.ensureReady()
        const limit = query.limit ?? 400
        return this.fetchMessagesFromScore(query.channelId, query.start.getTime(), limit, query.threadId)
    }

    async getRecentMessages(params: { channelId: string; threadId?: string; limit?: number }): Promise<StoredMessage[]> {
        await this.ensureReady()
        const limit = params.limit ?? 100
        if (limit <= 0) {
            return []
        }
        const ids = await this.client.zRange(this.orderKey(params.channelId), -limit, -1)
        if (!ids.length) {
            return []
        }
        const messages = await this.fetchMessagesByIds(params.channelId, ids)
        return params.threadId ? filterThreadMessages(messages, params.threadId) : messages
    }

    async getEarliestTimestamp(channelId: string): Promise<number | undefined> {
        await this.ensureReady()
        const result = await this.client.zRangeWithScores(this.orderKey(channelId), 0, 0)
        const first = result[0]
        return first ? first.score : undefined
    }

    async bulkSaveMessages(channelId: string, messages: StoredMessage[]): Promise<void> {
        await this.ensureReady()
        if (!messages.length) {
            return
        }
        const sorted = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        for (const message of sorted) {
            const exists = await this.client.exists(this.eventKey(channelId, message.eventId))
            if (exists) {
                continue
            }
            await this.saveMessage(message)
        }
    }

    private async fetchMessagesFromScore(
        channelId: string,
        startMs: number,
        limit: number,
        threadId?: string,
    ): Promise<StoredMessage[]> {
        const collected: StoredMessage[] = []
        let offset = 0
        const batchSize = Math.max(limit, DEFAULT_BATCH_SIZE)

        while (limit <= 0 || collected.length < limit) {
            const ids = await this.client.zRangeByScore(this.orderKey(channelId), startMs, '+inf', {
                LIMIT: {
                    offset,
                    count: batchSize,
                },
            })
            if (!ids.length) {
                break
            }
            offset += batchSize
            const messages = await this.fetchMessagesByIds(channelId, ids)
            const filtered = threadId ? filterThreadMessages(messages, threadId) : messages
            for (const message of filtered) {
                collected.push(message)
                if (limit > 0 && collected.length >= limit) {
                    return collected
                }
            }
            if (ids.length < batchSize) {
                break
            }
        }

        return collected
    }

    private async fetchMessagesByIds(channelId: string, ids: string[]): Promise<StoredMessage[]> {
        if (!ids.length) {
            return []
        }
        const keys = ids.map((id) => this.eventKey(channelId, id))
        const raws = await this.client.mGet(keys)
        const result: StoredMessage[] = []
        for (const raw of raws) {
            if (!raw) {
                continue
            }
            result.push(cloneStoredMessage(deserializeMessage(raw)))
        }
        return result
    }

    private orderKey(channelId: string): string {
        return `message-store:${channelId}:order`
    }

    private eventsSetKey(channelId: string): string {
        return `message-store:${channelId}:events`
    }

    private eventKey(channelId: string, eventId: string): string {
        return `message-store:${channelId}:event:${eventId}`
    }
}

function serializeMessage(message: StoredMessage): string {
    return JSON.stringify({
        ...message,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt ? message.updatedAt.toISOString() : undefined,
    })
}

function deserializeMessage(payload: string): StoredMessage {
    const parsed = JSON.parse(payload) as StoredMessage
    return {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : undefined,
    }
}

function filterThreadMessages(messages: StoredMessage[], threadId: string): StoredMessage[] {
    return messages.filter((message) => message.threadId === threadId || message.eventId === threadId)
}
