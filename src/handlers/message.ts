import type { AppBot } from '../types'
import { saveMessage } from '../storage/messageStore'

export function registerMessageHandler(bot: AppBot): void {
    bot.onMessage(async (handler, event) => {
        saveMessage({
            eventId: event.eventId,
            channelId: event.channelId,
            threadId: event.threadId ?? undefined,
            replyId: event.replyId ?? undefined,
            userId: event.userId,
            message: event.message,
            createdAt: event.createdAt,
        })
    })
}
