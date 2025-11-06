import type { AppBot } from '../types'
import { getMessages, getRecentMessages } from '../storage/messageStore'
import { parseTimeframe } from '../utils/timeframe'
import { summarizeConversation } from '../utils/summarizer'
import { ensureMessagesForRange } from '../utils/historyBackfill'

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

        if (timeframeInput && timeframe) {
            const twoWeeksMs = 14 * 24 * 60 * 60 * 1000
            const requestedMs = now.getTime() - timeframe.start.getTime()
            if (requestedMs > twoWeeksMs) {
                await handler.sendMessage(
                    event.channelId,
                    'Free plan can summarize up to the last 2 weeks only. Upgrade to the paid plan (coming soon) for larger timeframes.',
                    threadOptions(event),
                )
                return
            }
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

        const rangeStart = timeframe.start
        await ensureMessagesForRange(bot, event.channelId, rangeStart)

        let messages = getMessages({
            channelId: event.channelId,
            threadId: event.threadId ?? undefined,
            start: rangeStart,
            limit: 400, // TODO: Deal with the limit in a more flexible way
        })

        let summaryLabel = timeframe.label
        let summaryStart = rangeStart
        let fallbackNote: string | undefined

        if (!messages.length && isThread && !timeframeInput) {
            await ensureMessagesForRange(bot, event.channelId, new Date(0))
            messages = getMessages({
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
                start: new Date(0),
                limit: 400, // TODO: Deal with the limit in a more flexible way
            })
            summaryLabel = 'complete thread'
            summaryStart = messages[0]?.createdAt ?? rangeStart
        }

        if (!messages.length) {
            const fallbackMessages = getRecentMessages({
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
                limit: 400, // TODO: Deal with the limit in a more flexible way
            })

            if (!fallbackMessages.length) {
                await handler.editMessage(
                    event.channelId,
                    pending.eventId,
                    "I haven't seen any messages in this channel yet. I'll start keeping track now!",
                    threadOptions(event),
                )
                return
            }

            messages = fallbackMessages
            summaryLabel = isThread
                ? `latest ${messages.length} thread messages`
                : `latest ${messages.length} messages`
            summaryStart = messages[0]?.createdAt ?? summaryStart
            fallbackNote = timeframe.label
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

            const response = [`**Summary (${summaryLabel})**`, '\n\n', result.summary, '\n\n', footer]
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

function threadOptions(event: { threadId?: string | undefined; eventId: string }): {
    threadId: string
} {
    return {
        threadId: event.threadId ?? event.eventId,
    }
}
