import type { AppBot } from '../types'
import type { MessageStorage } from '../storage/types'
import { loadEventsSince } from './miniblockLoader'
import { transformEventsToPersistedMessages } from './eventTransform'

type Overrides = {
    loadEventsSince?: typeof loadEventsSince
    transformEventsToPersistedMessages?: typeof transformEventsToPersistedMessages
}

let loadEvents = loadEventsSince
let transformEvents = transformEventsToPersistedMessages

const inflightBackfills = new Map<string, Promise<void>>()

export async function ensureMessagesForRange(
    bot: AppBot,
    storage: MessageStorage,
    channelId: string,
    start: Date,
): Promise<void> {
    const startMs = start.getTime()
    const currentEarliest = await storage.getEarliestTimestamp(channelId)
    if (currentEarliest !== undefined && currentEarliest <= startMs) {
        return
    }

    const key = channelId
    const inProgress = inflightBackfills.get(key)
    if (inProgress) {
        await inProgress
        const updatedEarliest = await storage.getEarliestTimestamp(channelId)
        if (updatedEarliest !== undefined && updatedEarliest <= startMs) {
            return
        }
    }

    const task = (async () => {
        try {
            const events = await loadEvents(bot, channelId, start)
            const messages = await transformEvents(bot, channelId, events)
            const filtered = messages.filter((message) => message.userId.toLowerCase() !== bot.botId.toLowerCase())
            if (filtered.length) {
                await storage.bulkSaveMessages(channelId, filtered)
            }
        } catch (error) {
            console.warn('history backfill skipped', { channelId, error })
        }
    })()

    inflightBackfills.set(key, task)
    try {
        await task
    } finally {
        inflightBackfills.delete(key)
    }
}

export function __setHistoryBackfillHooks(overrides?: Overrides): void {
    loadEvents = overrides?.loadEventsSince ?? loadEventsSince
    transformEvents = overrides?.transformEventsToPersistedMessages ?? transformEventsToPersistedMessages
}
