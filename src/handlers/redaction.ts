import type { AppBot } from '../types'
import type { Storage } from '../storage/types'

export function registerRedactionHandler(bot: AppBot, storage: Storage): void {
    bot.onRedaction(async (_handler, event) => {
        await storage.removeMessage(event.channelId, event.refEventId)
    })
}
