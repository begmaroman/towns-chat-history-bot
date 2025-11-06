import type { BotHandler } from '@towns-protocol/bot'

import type { AppBot } from '../types'
import { getMessages, getRecentMessages } from '../storage/messageStore'
import { savePaymentRequest } from '../storage/paymentRequests'
import { parseTimeframe, type ParsedTimeframe } from '../utils/timeframe'
import { summarizeConversation } from '../utils/summarizer'
import { ensureMessagesForRange } from '../utils/historyBackfill'
import {
    calculateSummaryPayment,
    describeDuration,
    formatTokenAmount,
    formatUsd,
    getExpectedCurrencyAddress,
    getFreeSummaryWindowMs,
    getTokenSymbol,
} from '../utils/summaryPayment'

export function registerSummarizeHandler(bot: AppBot): void {
    bot.onSlashCommand('summarize', async (handler, event) => {
        const now = new Date()
        const isThread = Boolean(event.threadId)
        const timeframeInput = event.args.join(' ').trim()
        const responseThreadId = event.threadId ?? event.eventId

        let timeframe = timeframeInput ? parseTimeframe(timeframeInput, now) : undefined

        if (!timeframe && timeframeInput) {
            await handler.sendMessage(
                event.channelId,
                'Unable to understand timeframe. Try formats like `12h`, `2d`, `1w`, or phrases such as `last 3 hours`.',
                { threadId: responseThreadId },
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
                    { threadId: responseThreadId },
                )
                return
            }
        }

        if (!timeframe) {
            const freeWindowMs = getFreeSummaryWindowMs()
            timeframe = isThread
                ? {
                      start: new Date(0),
                      label: 'complete thread',
                  }
                : {
                      start: new Date(now.getTime() - freeWindowMs),
                      label: formatDurationLabel(freeWindowMs),
                  }
        }

        const durationMs = Math.max(0, now.getTime() - timeframe.start.getTime())
        const skipPayment = isThread && !timeframeInput

        if (!skipPayment) {
            const payment = calculateSummaryPayment(durationMs)
            if (payment.extraDays > 0) {
                const tokenSymbol = getTokenSymbol()
                const amountDisplay = formatTokenAmount(payment.requiredAmount)
                const usdDisplay = formatUsd(payment.usdCost)
                const freeWindowLabel = formatDurationLabel(getFreeSummaryWindowMs())
                const durationDescription = describeDuration(durationMs)
                const extraLabel = payment.extraDays === 1 ? 'day' : 'days'

                const paymentMessage = await handler.sendMessage(
                    event.channelId,
                    [
                        `Hi <@${event.userId}>, summaries beyond ${freeWindowLabel} cost $1 per extra day.`,
                        `This request spans about ${durationDescription} (${timeframe.label}), so ${payment.extraDays} ${extraLabel} fall outside the free allowance.`,
                        `Tip this message with ${usdDisplay} (${amountDisplay} ${tokenSymbol}) to continue. I'll generate the summary as soon as the payment arrives.`,
                    ].join(' '),
                    { threadId: responseThreadId },
                )

                savePaymentRequest({
                    paymentMessageId: paymentMessage.eventId,
                    channelId: event.channelId,
                    threadId: event.threadId ?? undefined,
                    responseThreadId,
                    timeframe,
                    timeframeInput: timeframeInput || undefined,
                    isThread,
                    requesterId: event.userId,
                    requiredAmount: payment.requiredAmount,
                    usdCost: payment.usdCost,
                    extraDays: payment.extraDays,
                    requestedAt: now,
                    expectedCurrency: getExpectedCurrencyAddress(),
                })

                return
            }
        }

        await performSummaryRequest({
            bot,
            handler,
            channelId: event.channelId,
            threadId: event.threadId ?? undefined,
            responseThreadId,
            timeframe,
            timeframeInput: timeframeInput || undefined,
            isThread,
        })
    })
}

export type SummaryExecutionContext = {
    bot: AppBot
    handler: BotHandler
    channelId: string
    threadId?: string
    responseThreadId: string
    timeframe: ParsedTimeframe
    timeframeInput?: string
    isThread: boolean
    pendingMessageId?: string
    acknowledgePayment?: boolean
}

export async function performSummaryRequest(context: SummaryExecutionContext): Promise<void> {
    const { bot, handler, channelId, threadId, responseThreadId, timeframe, timeframeInput, isThread } = context

    const threadOpts = { threadId: responseThreadId }
    let pendingMessageId = context.pendingMessageId

    if (pendingMessageId) {
        const prefix = context.acknowledgePayment ? 'Payment received! ' : ''
        await handler.editMessage(channelId, pendingMessageId, `${prefix}Preparing a summary... 📝`, threadOpts)
    } else {
        const pending = await handler.sendMessage(channelId, 'Preparing a summary... 📝', threadOpts)
        pendingMessageId = pending.eventId
    }

    if (!pendingMessageId) {
        return
    }

    const rangeStart = timeframe.start
    await ensureMessagesForRange(bot, channelId, rangeStart)

    let messages = getMessages({
        channelId,
        threadId,
        start: rangeStart,
        limit: 400,
    })

    let summaryLabel = timeframe.label
    let summaryStart = rangeStart
    let fallbackNote: string | undefined

    if (!messages.length && isThread && !timeframeInput) {
        await ensureMessagesForRange(bot, channelId, new Date(0))
        messages = getMessages({
            channelId,
            threadId,
            start: new Date(0),
            limit: 400,
        })
        summaryLabel = 'complete thread'
        summaryStart = messages[0]?.createdAt ?? rangeStart
    }

    if (!messages.length) {
        const fallbackMessages = getRecentMessages({
            channelId,
            threadId,
            limit: 400,
        })

        if (!fallbackMessages.length) {
            await handler.editMessage(
                channelId,
                pendingMessageId,
                "I haven't seen any messages in this channel yet. I'll start keeping track now!",
                threadOpts,
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
            channelId,
            threadId,
        })

        const footerNotes: string[] = []
        if (fallbackNote) {
            footerNotes.push(
                `No activity detected in the past ${fallbackNote}. Summarized the most recent messages I have stored instead.`,
            )
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

        await handler.editMessage(channelId, pendingMessageId, response, threadOpts)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        await handler.editMessage(
            channelId,
            pendingMessageId,
            `Failed to generate summary: ${message}`,
            threadOpts,
        )
    }
}

function formatDurationLabel(durationMs: number): string {
    if (durationMs <= 0) {
        return '0 hours'
    }

    const days = durationMs / (24 * 60 * 60 * 1000)
    if (Number.isInteger(days) && days >= 1) {
        if (days === 1) {
            return '24 hours'
        }
        return `${days.toFixed(0)} days`
    }

    const hours = durationMs / (60 * 60 * 1000)
    if (Number.isInteger(hours)) {
        return `${hours.toFixed(0)} hours`
    }

    const minutes = durationMs / (60 * 1000)
    return `${minutes.toFixed(0)} minutes`
}
