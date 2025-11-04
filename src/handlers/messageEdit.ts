import type { AppBot } from '../types'
import { updateMessageContent } from '../storage/messageStore'

export function registerMessageEditHandler(bot: AppBot): void {
    bot.onMessageEdit(async (_handler, event) => {
        updateMessageContent(event.channelId, {
            eventId: event.refEventId,
            message: event.message,
            editedAt: event.createdAt,
        })
    })
}
