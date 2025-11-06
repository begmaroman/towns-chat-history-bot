import type { AppBot } from '../types'
import { consumePaymentRequest, getPaymentRequest } from '../storage/paymentRequests'
import { formatTokenAmount, formatUsd, getTokenSymbol } from '../utils/summaryPayment'
import { performSummaryRequest } from './summarize'

export function registerTipHandler(bot: AppBot): void {
    bot.onTip(async (handler, event) => {
        if (event.receiverUserId.toLowerCase() !== bot.botId.toLowerCase()) {
            return
        }

        const request = getPaymentRequest(event.messageId)
        if (!request) {
            return
        }

        const expectedCurrency = request.expectedCurrency
        const tokenSymbol = getTokenSymbol()
        if (expectedCurrency && event.currency.toLowerCase() !== expectedCurrency) {
            await handler.sendMessage(
                event.channelId,
                `Tip received in an unsupported token. Please use ${tokenSymbol} for summary payments.`,
                { threadId: request.responseThreadId },
            )
            return
        }

        if (event.userId.toLowerCase() !== request.requesterId.toLowerCase()) {
            await handler.sendMessage(
                event.channelId,
                `Thanks for the tip! I'm waiting for payment from <@${request.requesterId}> to run the summary.`,
                { threadId: request.responseThreadId },
            )
            return
        }

        if (event.amount < request.requiredAmount) {
            const receivedDisplay = formatTokenAmount(event.amount)
            const expectedDisplay = formatTokenAmount(request.requiredAmount)
            const shortfall = request.requiredAmount - event.amount
            const shortfallDisplay = formatTokenAmount(shortfall)

            await handler.sendMessage(
                event.channelId,
                `Received ${receivedDisplay} ${tokenSymbol}, but I need ${expectedDisplay} ${tokenSymbol} (` +
                    `${formatUsd(request.usdCost)}) to unlock this summary. Please tip an additional ${shortfallDisplay} ${tokenSymbol}.`,
                { threadId: request.responseThreadId },
            )
            return
        }

        const completed = consumePaymentRequest(event.messageId)
        if (!completed) {
            return
        }

        await performSummaryRequest({
            bot,
            handler,
            channelId: completed.channelId,
            threadId: completed.threadId,
            responseThreadId: completed.responseThreadId,
            timeframe: completed.timeframe,
            timeframeInput: completed.timeframeInput,
            isThread: completed.isThread,
            pendingMessageId: completed.paymentMessageId,
            acknowledgePayment: true,
        })
    })
}
