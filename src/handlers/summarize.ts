import type { BotHandler } from '@towns-protocol/bot'

import type { AppBot } from '../types'
import { MESSAGE_RETENTION_MS } from '../storage/constants'
import { TIMEFRAME_USAGE_HELP, findUnknownTimeframeWords, parseTimeframe } from '../utils/timeframe'
import type { SummaryService } from '../services/summary'
import type { Storage } from '../storage/types'

type TipEventPayload = Parameters<Parameters<AppBot['onTip']>[0]>[1]

export function registerSummarizeHandler(bot: AppBot, storage: Storage, summaryService: SummaryService): void {
    
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

        const replyThreadId = threadOptions(event).threadId

        const paymentPrompt = await handler.sendMessage(
            event.channelId,
            buildTipRequestMessage(timeframe.label),
            { threadId: replyThreadId },
        )

        await storage.savePendingSummaryRequest({
            promptMessageId: paymentPrompt.eventId,
            channelId: event.channelId,
            threadId: event.threadId ?? undefined,
            replyThreadId,
            timeframe,
            requestedBy: event.userId,
        })
    })

    bot.onTip(async (handler, event: TipEventPayload) => {
        const pending = await storage.getPendingSummaryRequest(event.messageId)
        if (!pending) {
            return
        }

        await storage.deletePendingSummaryRequest(event.messageId)

        const pendingMessage = await handler.sendMessage(
            pending.channelId,
            'Tip received! Preparing a summary... 📝',
            { threadId: pending.replyThreadId },
        )

        try {
            const summary = await summaryService.getSummary({
                channelId: pending.channelId,
                threadId: pending.threadId,
                timeframe: pending.timeframe,
            })

            await handler.editMessage(
                pending.channelId,
                pendingMessage.eventId,
                summary,
                { threadId: pending.replyThreadId },
            )
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            const refund = await refundTip(handler, event)
            const refundNote = refund.ok
                ? 'Your tip has been refunded.'
                : `Tip refund failed: ${refund.error}`
            await handler.editMessage(
                pending.channelId,
                pendingMessage.eventId,
                `Failed to generate summary: ${message} ${refundNote}`,
                { threadId: pending.replyThreadId },
            )

            // Allow users to retry by tipping again
            await storage.savePendingSummaryRequest(pending)
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

function buildTipRequestMessage(timeframeLabel: string): string {
    return [
        `Tip this message to unlock a summary covering ${timeframeLabel}.`,
        'Once I receive a tip, I\'ll post the summary right here.',
    ].join(' ')
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

async function refundTip(handler: BotHandler, event: TipEventPayload): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
        await handler.sendTip({
            userId: event.userId,
            channelId: event.channelId,
            messageId: event.messageId,
            amount: event.amount,
            currency: event.currency,
        })
        return { ok: true }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { ok: false, error: message }
    }
}
