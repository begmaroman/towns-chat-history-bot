import type { AppBot } from '../types'
import type { MessageStorage } from '../storage/types'

export function registerMessageEditHandler(bot: AppBot, storage: MessageStorage): void {
    bot.onMessageEdit(async (_handler, event) => {
        await storage.updateMessageContent(event.channelId, {
            eventId: event.refEventId,
            message: event.message,
            editedAt: event.createdAt,
        })
    })
}
