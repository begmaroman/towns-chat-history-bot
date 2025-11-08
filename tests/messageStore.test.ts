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

    it('stores messages ordered by timestamp and filters by thread', () => {
        storage.saveMessage(makeMessage({ eventId: 'b', createdAt: minutesBefore(5) }))
        storage.saveMessage(makeMessage({ eventId: 'a', createdAt: minutesBefore(10) }))
        storage.saveMessage(makeMessage({ eventId: 'thread-root', threadId: undefined, createdAt: minutesBefore(20) }))
        storage.saveMessage(makeMessage({ eventId: 'thread-child', threadId: 'thread-root', createdAt: minutesBefore(15) }))

        const result = storage.getMessages({ channelId: CHANNEL, start: new Date(0), limit: 10 })
        expect(result.map((m) => m.eventId)).toEqual(['thread-root', 'thread-child', 'a', 'b'])

        const threadMessages = storage.getMessages({ channelId: CHANNEL, threadId: 'thread-root', start: new Date(0), limit: 10 })
        expect(threadMessages.map((m) => m.eventId)).toEqual(['thread-root', 'thread-child'])
    })

    it('updates and removes messages in place', () => {
        storage.saveMessage(makeMessage({ eventId: 'update-me', message: 'original' }))

        storage.updateMessageContent(CHANNEL, {
            eventId: 'update-me',
            message: 'edited',
            editedAt: new Date(),
        })

        let stored = storage.getMessages({ channelId: CHANNEL, start: new Date(0) })
        expect(stored[0]?.message).toBe('edited')
        expect(stored[0]?.updatedAt).toBeInstanceOf(Date)

        storage.removeMessage(CHANNEL, 'update-me')
        stored = storage.getMessages({ channelId: CHANNEL, start: new Date(0) })
        expect(stored).toHaveLength(0)
    })

    it('returns recent messages with limit and tracks earliest timestamp', () => {
        storage.saveMessage(makeMessage({ eventId: 'old', createdAt: minutesBefore(120) }))
        storage.saveMessage(makeMessage({ eventId: 'mid', createdAt: minutesBefore(60) }))
        storage.saveMessage(makeMessage({ eventId: 'new', createdAt: minutesBefore(10) }))

        const recent = storage.getRecentMessages({ channelId: CHANNEL, limit: 2 })
        expect(recent.map((m) => m.eventId)).toEqual(['mid', 'new'])

        const earliest = storage.getEarliestTimestamp(CHANNEL)
        expect(earliest).toBeDefined()
        expect(earliest).toBe(minutesBefore(120).getTime())
    })

    it('bulk saves messages without duplicating existing entries', () => {
        const bulk = [
            makeMessage({ eventId: 'bulk-1', createdAt: minutesBefore(30) }),
            makeMessage({ eventId: 'bulk-2', createdAt: minutesBefore(20) }),
        ]
        storage.bulkSaveMessages(CHANNEL, bulk)
        storage.bulkSaveMessages(CHANNEL, bulk) // second call should be ignored for duplicates

        const stored = storage.getMessages({ channelId: CHANNEL, start: new Date(0) })
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
