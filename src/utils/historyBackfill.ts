import type { AppBot } from '../types'
import { bulkSaveMessages, getEarliestTimestamp } from '../storage/messageStore'
import { loadEventsSince } from './miniblockLoader'
import { transformEventsToPersistedMessages } from './eventTransform'

type Overrides = {
    loadEventsSince?: typeof loadEventsSince
    transformEventsToPersistedMessages?: typeof transformEventsToPersistedMessages
    bulkSaveMessages?: typeof bulkSaveMessages
}

let loadEvents = loadEventsSince
let transformEvents = transformEventsToPersistedMessages
let saveMessages = bulkSaveMessages

const inflightBackfills = new Map<string, Promise<void>>()

export async function ensureMessagesForRange(bot: AppBot, channelId: string, start: Date): Promise<void> {
    const startMs = start.getTime()
    const currentEarliest = getEarliestTimestamp(channelId)
    if (currentEarliest !== undefined && currentEarliest <= startMs) {
        return
    }

    const key = channelId
    const inProgress = inflightBackfills.get(key)
    if (inProgress) {
        await inProgress
        const updatedEarliest = getEarliestTimestamp(channelId)
        if (updatedEarliest !== undefined && updatedEarliest <= startMs) {
            return
        }
    }

    const task = (async () => {
        try {
            const events = await loadEvents(bot, channelId, start)
            const messages = await transformEvents(bot, channelId, events)
            const filtered = messages.filter((message) => message.userId !== bot.botId)
            if (filtered.length) {
                saveMessages(channelId, filtered)
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
    saveMessages = overrides?.bulkSaveMessages ?? bulkSaveMessages
}
