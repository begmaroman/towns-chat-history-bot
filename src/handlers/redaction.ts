import type { AppBot } from '../types'
import { removeMessage } from '../storage/messageStore'

export function registerRedactionHandler(bot: AppBot): void {
    bot.onRedaction(async (_handler, event) => {
        removeMessage(event.channelId, event.refEventId)
    })
}
