import type { AppBot } from '../types'

export function registerHelpHandler(bot: AppBot): void {
    bot.onSlashCommand('help', async (handler, { channelId }) => {
        const helpMessage =
            '**Available Commands:**\n\n' +
            '• `/help` — Show this help message\n\n' +
            '• `/summarize [duration]` — Summarize recent history (defaults to 24h)\n\n' +
            '    ◦ Duration examples: `30m`, `12h`, `2d`, `last 3 hours`\n\n' +
            '**Message Triggers:**\n\n' +
            '• Mention me — I will remind you about `/summarize`'

        await handler.sendMessage(channelId, helpMessage)
    })
}
