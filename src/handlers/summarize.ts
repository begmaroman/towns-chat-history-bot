import type { BotHandler } from '@towns-protocol/bot'

import type { AppBot } from '../types'
import { TIMEFRAME_USAGE_HELP, findUnknownTimeframeWords, parseTimeframe, type ParsedTimeframe } from '../utils/timeframe'
import type { SummaryService } from '../services/summary'
import type { Storage } from '../storage/types'

const FREE_SUMMARY_MS = 24 * 60 * 60 * 1000
const MAX_SUMMARY_MS = 14 * FREE_SUMMARY_MS

type TipEventPayload = Parameters<Parameters<AppBot['onTip']>[0]>[1]

export function registerSummarizeHandler(bot: AppBot, storage: Storage, summaryService: SummaryService): void {
    bot.onSlashCommand('summarize', async (handler, event) => {
        const now = new Date()
        const isThread = Boolean(event.threadId)
        const timeframeInput = event.args.join(' ').trim()
        const hasCustomTimeframe = timeframeInput.length > 0

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

        timeframe = enforceMaxTimeframe(timeframe, now, hasCustomTimeframe, isThread)
        if (!timeframe) {
            await handler.sendMessage(
                event.channelId,
                'History is retained for up to 14 days only. Please request a shorter window.',
                threadOptions(event),
            )
            return
        }

        const replyThreadId = threadOptions(event).threadId

        const requiresTip = requiresTipForTimeframe(timeframe, now)
        if (!requiresTip) {
            await generateSummary(handler, summaryService, {
                channelId: event.channelId,
                threadId: event.threadId ?? undefined,
                replyThreadId,
                timeframe,
            })
            return
        }

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
            await finishSummary(handler, summaryService, {
                channelId: pending.channelId,
                threadId: pending.threadId,
                replyThreadId: pending.replyThreadId,
                timeframe: pending.timeframe,
                messageId: pendingMessage.eventId,
            })
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
        `Summaries longer than 24 hours require a tip. Tip this message to unlock a summary covering ${timeframeLabel}.`,
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

function requiresTipForTimeframe(timeframe: ParsedTimeframe, now: Date): boolean {
    const diffMs = now.getTime() - timeframe.start.getTime()
    return diffMs > FREE_SUMMARY_MS
}

function enforceMaxTimeframe(
    timeframe: ParsedTimeframe | undefined,
    now: Date,
    hasCustomTimeframe: boolean,
    isThread: boolean,
): ParsedTimeframe | undefined {
    if (!timeframe) {
        return undefined
    }
    const maxStartMs = now.getTime() - MAX_SUMMARY_MS
    if (timeframe.start.getTime() >= maxStartMs) {
        return timeframe
    }
    if (hasCustomTimeframe) {
        return undefined
    }
    return {
        start: new Date(maxStartMs),
        label: isThread ? 'last 14 days of thread' : 'last 14 days',
    }
}

async function generateSummary(
    handler: BotHandler,
    summaryService: SummaryService,
    params: {
        channelId: string
        threadId?: string
        replyThreadId: string
        timeframe: ParsedTimeframe
    },
): Promise<void> {
    const pending = await handler.sendMessage(
        params.channelId,
        'Preparing a summary... 📝',
        { threadId: params.replyThreadId },
    )

    try {
        await finishSummary(handler, summaryService, {
            channelId: params.channelId,
            threadId: params.threadId,
            replyThreadId: params.replyThreadId,
            timeframe: params.timeframe,
            messageId: pending.eventId,
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        await handler.editMessage(
            params.channelId,
            pending.eventId,
            `Failed to generate summary: ${message}`,
            { threadId: params.replyThreadId },
        )
    }
}

async function finishSummary(
    handler: BotHandler,
    summaryService: SummaryService,
    params: {
        channelId: string
        threadId?: string
        replyThreadId: string
        timeframe: ParsedTimeframe
        messageId: string
    },
): Promise<void> {
    const summary = await summaryService.getSummary({
        channelId: params.channelId,
        threadId: params.threadId,
        timeframe: params.timeframe,
    })

    await handler.editMessage(
        params.channelId,
        params.messageId,
        summary,
        { threadId: params.replyThreadId },
    )
}
