import type { AppBot } from '../types'
import { transformEventsToPersistedMessages } from './eventTransform'
import { loadEventsSince } from "./miniblockLoader";

export async function dumpStreamMessages(bot: AppBot, streamIdHex: string): Promise<void> {
    if (!streamIdHex) {
        throw new Error('DEBUG_STREAM_ID must be a non-empty hex string')
    }

    const twelveHoursAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    const events = await loadEventsSince(bot, streamIdHex, twelveHoursAgo)
    const messages = await transformEventsToPersistedMessages(bot, streamIdHex, events)

    console.log(messages)
}
