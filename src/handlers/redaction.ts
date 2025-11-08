import type { AppBot } from '../types'
import type { MessageStorage } from '../storage/types'

export function registerRedactionHandler(bot: AppBot, storage: MessageStorage): void {
    bot.onRedaction(async (_handler, event) => {
        await storage.removeMessage(event.channelId, event.refEventId)
    })
}
