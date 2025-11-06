import type { ParsedTimeframe } from '../utils/timeframe'

export type SummaryPaymentRequest = {
    paymentMessageId: string
    channelId: string
    threadId?: string
    responseThreadId: string
    timeframe: ParsedTimeframe
    timeframeInput?: string
    isThread: boolean
    requesterId: string
    requiredAmount: bigint
    usdCost: number
    extraDays: number
    requestedAt: Date
    expectedCurrency?: string
}

const requests = new Map<string, SummaryPaymentRequest>()

export function savePaymentRequest(request: SummaryPaymentRequest): void {
    requests.set(request.paymentMessageId, clone(request))
}

export function getPaymentRequest(messageId: string): SummaryPaymentRequest | undefined {
    const stored = requests.get(messageId)
    return stored ? clone(stored) : undefined
}

export function consumePaymentRequest(messageId: string): SummaryPaymentRequest | undefined {
    const stored = requests.get(messageId)
    if (!stored) {
        return undefined
    }
    requests.delete(messageId)
    return clone(stored)
}

export function clearPaymentRequests(): void {
    requests.clear()
}

function clone(request: SummaryPaymentRequest): SummaryPaymentRequest {
    return {
        ...request,
        timeframe: {
            ...request.timeframe,
            start: new Date(request.timeframe.start),
        },
        requestedAt: new Date(request.requestedAt),
    }
}
