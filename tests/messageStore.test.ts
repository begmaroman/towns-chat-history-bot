import { beforeEach, describe, expect, it } from 'bun:test'

import { InMemoryMessageStorage } from '../src/storage/inmem'
import type { SaveMessageInput } from '../src/storage/types'

const CHANNEL = 'channel-1'
const BASE_TIME = new Date('2024-01-01T00:00:00.000Z')
let storage: InMemoryMessageStorage

describe('message storage service', () => {
    beforeEach(() => {
        storage = new InMemoryMessageStorage()
    })

    it('stores messages ordered by timestamp and filters by thread', async () => {
        await storage.saveMessage(makeMessage({ eventId: 'b', createdAt: minutesBefore(5) }))
        await storage.saveMessage(makeMessage({ eventId: 'a', createdAt: minutesBefore(10) }))
        await storage.saveMessage(makeMessage({ eventId: 'thread-root', threadId: undefined, createdAt: minutesBefore(20) }))
        await storage.saveMessage(makeMessage({ eventId: 'thread-child', threadId: 'thread-root', createdAt: minutesBefore(15) }))

        const result = await storage.getMessages({ channelId: CHANNEL, start: new Date(0), limit: 10 })
        expect(result.map((m) => m.eventId)).toEqual(['thread-root', 'thread-child', 'a', 'b'])

        const threadMessages = await storage.getMessages({ channelId: CHANNEL, threadId: 'thread-root', start: new Date(0), limit: 10 })
        expect(threadMessages.map((m) => m.eventId)).toEqual(['thread-root', 'thread-child'])
    })

    it('updates and removes messages in place', async () => {
        await storage.saveMessage(makeMessage({ eventId: 'update-me', message: 'original' }))

        await storage.updateMessageContent(CHANNEL, {
            eventId: 'update-me',
            message: 'edited',
            editedAt: new Date(),
        })

        let stored = await storage.getMessages({ channelId: CHANNEL, start: new Date(0) })
        expect(stored[0]?.message).toBe('edited')
        expect(stored[0]?.updatedAt).toBeInstanceOf(Date)

        await storage.removeMessage(CHANNEL, 'update-me')
        stored = await storage.getMessages({ channelId: CHANNEL, start: new Date(0) })
        expect(stored).toHaveLength(0)
    })

    it('returns recent messages with limit and tracks earliest timestamp', async () => {
        await storage.saveMessage(makeMessage({ eventId: 'old', createdAt: minutesBefore(120) }))
        await storage.saveMessage(makeMessage({ eventId: 'mid', createdAt: minutesBefore(60) }))
        await storage.saveMessage(makeMessage({ eventId: 'new', createdAt: minutesBefore(10) }))

        const recent = await storage.getRecentMessages({ channelId: CHANNEL, limit: 2 })
        expect(recent.map((m) => m.eventId)).toEqual(['mid', 'new'])

        const earliest = await storage.getEarliestTimestamp(CHANNEL)
        expect(earliest).toBeDefined()
        expect(earliest).toBe(minutesBefore(120).getTime())
    })

    it('bulk saves messages without duplicating existing entries', async () => {
        const bulk = [
            makeMessage({ eventId: 'bulk-1', createdAt: minutesBefore(30) }),
            makeMessage({ eventId: 'bulk-2', createdAt: minutesBefore(20) }),
        ]
        await storage.bulkSaveMessages(CHANNEL, bulk)
        await storage.bulkSaveMessages(CHANNEL, bulk) // second call should be ignored for duplicates

        const stored = await storage.getMessages({ channelId: CHANNEL, start: new Date(0) })
        expect(stored).toHaveLength(2)
        expect(stored.map((m) => m.eventId)).toEqual(['bulk-1', 'bulk-2'])
    })
})

function makeMessage(overrides: Partial<SaveMessageInput> = {}): SaveMessageInput {
    return {
        eventId: overrides.eventId ?? crypto.randomUUID(),
        channelId: overrides.channelId ?? CHANNEL,
        userId: overrides.userId ?? '0xaaa',
        message: overrides.message ?? 'message',
        createdAt: overrides.createdAt ?? new Date(BASE_TIME),
        threadId: overrides.threadId,
        replyId: overrides.replyId,
    }
}

function minutesBefore(mins: number): Date {
    return new Date(BASE_TIME.getTime() - mins * 60_000)
}
