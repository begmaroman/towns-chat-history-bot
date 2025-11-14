import type { AppBot } from '../types'
import { MESSAGE_RETENTION_MS } from '../storage/constants'
import { TIMEFRAME_USAGE_HELP, findUnknownTimeframeWords, parseTimeframe } from '../utils/timeframe'
import type { SummaryService } from '../services/summary'

export function registerSummarizeHandler(bot: AppBot, summaryService: SummaryService): void {
    bot.onSlashCommand('summarize', async (handler, event) => {
        const now = new Date()
        const isThread = Boolean(event.threadId)
        const timeframeInput = event.args.join(' ').trim()

        const unknownWords = timeframeInput ? findUnknownTimeframeWords(timeframeInput) : []
        if (timeframeInput && unknownWords.length) {
            await handler.sendMessage(
                event.channelId,
                `I don't recognize ${formatWordList(unknownWords)} in that timeframe request. ${TIMEFRAME_USAGE_HELP}`,
                threadOptions(event),
            )
            return
        }

        let timeframe = timeframeInput ? parseTimeframe(timeframeInput, now) : undefined

        if (!timeframe && timeframeInput) {
            await handler.sendMessage(
                event.channelId,
                `Unable to understand timeframe. ${TIMEFRAME_USAGE_HELP}`,
                threadOptions(event),
            )
            return
        }

        if (timeframeInput && timeframe) {
            const retentionLimitMs = MESSAGE_RETENTION_MS
            const requestedMs = now.getTime() - timeframe.start.getTime()
            if (requestedMs > retentionLimitMs) {
                await handler.sendMessage(
                    event.channelId,
                    'History is retained for up to 30 days only. Please request a shorter window.',
                    threadOptions(event),
                )
                return
            }
            const twoWeeksMs = 14 * 24 * 60 * 60 * 1000
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

        try {
            const summary = await summaryService.getSummary({
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
                timeframe,
            })

            await handler.editMessage(
                event.channelId,
                pending.eventId,
                summary,
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

function formatWordList(words: string[]): string {
    if (words.length === 1) {
        return `"${words[0]}"`
    }
    if (words.length === 2) {
        return `"${words[0]}" and "${words[1]}"`
    }
    const last = words[words.length - 1]
    const initial = words
        .slice(0, -1)
        .map((word) => `"${word}"`)
        .join(', ')
    return `${initial}, and "${last}"`
}
