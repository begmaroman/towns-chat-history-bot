import type { AppBot } from '../types'
import { getMessages } from '../storage/messageStore'
import { parseTimeframe } from '../utils/timeframe'
import { summarizeConversation } from '../utils/summarizer'

const DEFAULT_TIMEFRAME = '24h'

export function registerSummarizeHandler(bot: AppBot): void {
    bot.onSlashCommand('summarize', async (handler, event) => {
        const now = new Date()
        const timeframeInput = event.args.join(' ').trim() || DEFAULT_TIMEFRAME
        const timeframe = parseTimeframe(timeframeInput, now)

        if (!timeframe) {
            await handler.sendMessage(
                event.channelId,
                'Unable to understand timeframe. Try formats like `12h`, `2d`, `1w`, or phrases such as `last 3 hours`.',
                threadOptions(event),
            )
            return
        }

        const messages = getMessages({
            channelId: event.channelId,
            threadId: event.threadId ?? undefined,
            start: timeframe.start,
            end: timeframe.end,
            limit: 400,
        })

        if (!messages.length) {
            await handler.sendMessage(
                event.channelId,
                `I don't have any stored messages for the past ${timeframe.label}.`,
                threadOptions(event),
            )
            return
        }

        try {
            const result = await summarizeConversation({
                messages,
                timeframeLabel: timeframe.label,
                start: timeframe.start,
                end: timeframe.end,
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
            })

            const footer = result.truncated
                ? `_Analyzed ${result.usedMessages} messages (older messages truncated to stay within limits)._`
                : `_Analyzed ${result.usedMessages} messages._`

            const response = [`**Summary (${timeframe.label})**`, '', result.summary, '', footer]
                .filter(Boolean)
                .join('\n')

            await handler.sendMessage(event.channelId, response, threadOptions(event))
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            await handler.sendMessage(
                event.channelId,
                `Failed to generate summary: ${message}`,
                threadOptions(event),
            )
        }
    })
}

function threadOptions(event: { threadId?: string | undefined }):
    | {
          threadId: string
      }
    | undefined {
    return event.threadId
        ? {
              threadId: event.threadId,
          }
        : undefined
}
