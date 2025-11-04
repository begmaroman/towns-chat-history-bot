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

        if (event.userId === bot.botId) {
            return
        }

        if (event.isMentioned) {
            await handler.sendMessage(
                event.channelId,
                'Hi there! Use `/summarize [duration]` if you need a recap of recent activity.',
            )
        }
    })
}
