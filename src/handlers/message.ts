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
            await handler.sendMessage(event.channelId, 'You mentioned me! 👀')
            return
        }

        const message = event.message.toLowerCase()

        if (message.includes('hello')) {
            await handler.sendMessage(event.channelId, 'Hello there! 👋')
            return
        }

        if (message.includes('ping')) {
            const latency = Date.now() - event.createdAt.getTime()
            await handler.sendMessage(event.channelId, `Pong! 🏓 ${latency}ms`)
            return
        }

        if (message.includes('react')) {
            await handler.sendReaction(event.channelId, event.eventId, '👍')
        }
    })
}
