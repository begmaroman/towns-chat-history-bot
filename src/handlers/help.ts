import type { AppBot } from '../types'

export function registerHelpHandler(bot: AppBot): void {
    bot.onSlashCommand('help', async (handler, { channelId }) => {
        const helpMessage =
            '**Available Commands:**\n\n' +
            '• `/help` — Show this help message.\n\n' +
            '• `/summarize [duration]` — Summarize recent history (defaults to 24h). Optional in threads. Duration examples: `30m`, `12h`, `2d`, `last 3 hours`.'

        await handler.sendMessage(channelId, helpMessage)
    })
}
