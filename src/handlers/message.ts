import type { AppBot } from '../types'
import type { Storage } from '../storage/types'

export function registerMessageHandler(bot: AppBot, storage: Storage): void {
    bot.onMessage(async (_handler, event) => {
        await storage.saveMessage({
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
