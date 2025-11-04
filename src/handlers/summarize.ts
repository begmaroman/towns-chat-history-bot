import type { AppBot } from '../types'
import { getMessages, getRecentMessages } from '../storage/messageStore'
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

        let messages = getMessages({
            channelId: event.channelId,
            threadId: event.threadId ?? undefined,
            start: timeframe.start,
            end: timeframe.end,
            limit: 400,
        })

        let summaryLabel = timeframe.label
        let summaryStart = timeframe.start
        let summaryEnd = timeframe.end
        let fallbackNote: string | undefined

        if (!messages.length) {
            const fallbackMessages = getRecentMessages({
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
                limit: 200,
            })

            if (!fallbackMessages.length) {
                await handler.sendMessage(
                    event.channelId,
                    "I haven't seen any messages in this channel yet. I'll start keeping track now!",
                    threadOptions(event),
                )
                return
            }

            messages = fallbackMessages
            summaryLabel = `latest ${messages.length} messages`
            summaryStart = messages[0]!.createdAt
            summaryEnd = messages[messages.length - 1]!.createdAt
            fallbackNote = timeframe.label
        }

        try {
            const result = await summarizeConversation({
                messages,
                timeframeLabel: summaryLabel,
                start: summaryStart,
                end: summaryEnd,
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
            })

            const footerNotes: string[] = []
            if (fallbackNote) {
                footerNotes.push(`No activity detected in the past ${fallbackNote}. Summarized the most recent messages I have stored instead.`)
            }
            footerNotes.push(
                result.truncated
                    ? `Analyzed ${result.usedMessages} messages (older messages truncated to stay within limits).`
                    : `Analyzed ${result.usedMessages} messages.`,
            )

            const footer = footerNotes.length ? `_${footerNotes.join(' ')}_` : undefined

            const response = [`**Summary (${summaryLabel})**`, '', result.summary, '', footer]
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
