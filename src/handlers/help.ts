import type { AppBot } from '../types'
import { TIMEFRAME_USAGE_HELP } from '../utils/timeframe'

export function registerHelpHandler(bot: AppBot): void {
    bot.onSlashCommand('help', async (handler, { channelId }) => {
        const helpMessage =
            '**Available Commands:**\n\n' +
            '• `/help` — Show this help message.\n\n' +
            '• `/summarize [timeframe]` — Summarize recent history (defaults to 24h). ' +
            `${TIMEFRAME_USAGE_HELP}`

        await handler.sendMessage(channelId, helpMessage)
    })
}
