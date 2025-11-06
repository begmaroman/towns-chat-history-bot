import type { AppBot } from '../types'
import { getMessages, getRecentMessages } from '../storage/messageStore'
import { parseTimeframe } from '../utils/timeframe'
import { summarizeConversation } from '../utils/summarizer'

const DEFAULT_TIMEFRAME = '24h'

export function registerSummarizeHandler(bot: AppBot): void {
    bot.onSlashCommand('summarize', async (handler, event) => {
        const now = new Date()
        const isThread = Boolean(event.threadId)
        const timeframeInput = event.args.join(' ').trim()

        let timeframe = timeframeInput ? parseTimeframe(timeframeInput, now) : undefined

        if (!timeframe && timeframeInput) {
            await handler.sendMessage(
                event.channelId,
                'Unable to understand timeframe. Try formats like `12h`, `2d`, `1w`, or phrases such as `last 3 hours`.',
                threadOptions(event),
            )
            return
        }

        if (!timeframe) {
            timeframe = isThread
                ? {
                      start: new Date(0),
                      label: 'complete thread',
                  }
                : {
                      start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
                      label: '24 hours',
                  }
        }

        const pending = await handler.sendMessage(
            event.channelId,
            'Preparing a summary... 📝',
            threadOptions(event),
        )

        // TODO: Deal with the max limit properly. Think about how to handle large threads or channels.
        let messages = getMessages({
            channelId: event.channelId,
            threadId: event.threadId ?? undefined,
            start: timeframe.start,
            limit: 400,
        })

        let summaryLabel = timeframe.label
        let summaryStart = timeframe.start
        let fallbackNote: string | undefined

        if (!messages.length && isThread && !timeframeInput) {
            messages = getMessages({
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
                start: new Date(0),
                limit: 400,
            })
            summaryLabel = 'complete thread'
            summaryStart = messages[0]?.createdAt ?? timeframe.start
        }

        if (!messages.length) {
            await handler.editMessage(
              event.channelId,
              pending.eventId,
              "I haven't seen any messages in this channel yet. I'll start keeping track now!",
              threadOptions(event),
            )
            return
        }

        try {
            const result = await summarizeConversation({
                messages,
                timeframeLabel: summaryLabel,
                start: summaryStart,
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

            const response = [`**Summary (${summaryLabel})**`, '', result.summary, '\n\n', footer]
                .filter(Boolean)
                .join('\n')

            await handler.editMessage(
                event.channelId,
                pending.eventId,
                response,
                threadOptions(event),
            )
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            await handler.editMessage(
                event.channelId,
                pending.eventId,
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
