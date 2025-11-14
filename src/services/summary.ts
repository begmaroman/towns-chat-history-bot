import type { AppBot } from '../types'
import type { Storage } from '../storage/types'
import { summarizeConversation } from '../utils/summarizer'
import type { ParsedTimeframe } from '../utils/timeframe'
import { ensureMessagesForRange } from '../utils/historyBackfill'

export type SummaryRequest = {
    channelId: string
    threadId?: string
    timeframe: ParsedTimeframe
}

export interface SummaryService {
    getSummary(args: SummaryRequest): Promise<string>
}

const DEFAULT_MAX_MESSAGES = 400

export class DefaultSummaryService implements SummaryService {
    constructor(private readonly bot: AppBot, private readonly storage: Storage, private readonly options?: {
        maxMessages?: number
    }) {}

    async getSummary(request: SummaryRequest): Promise<string> {
        const { channelId, threadId, timeframe } = request
        const maxMessages = this.options?.maxMessages ?? DEFAULT_MAX_MESSAGES
        const isThread = Boolean(threadId)

        await ensureMessagesForRange(this.bot, this.storage, channelId, timeframe.start)

        let messages = await this.storage.getMessages({
            channelId,
            threadId,
            start: timeframe.start,
            limit: maxMessages,
        })

        let summaryLabel = timeframe.label
        let summaryStart = timeframe.start
        let fallbackNote: string | undefined

        if (!messages.length && isThread && timeframe.start.getTime() === 0) {
            await ensureMessagesForRange(this.bot, this.storage, channelId, new Date(0))
            messages = await this.storage.getMessages({
                channelId,
                threadId,
                start: new Date(0),
                limit: maxMessages,
            })
            summaryLabel = 'complete thread'
        }

        if (!messages.length) {
            const fallbackMessages = await this.storage.getRecentMessages({
                channelId,
                threadId,
                limit: maxMessages,
            })

            if (!fallbackMessages.length) {
                return "I haven't seen any messages in this channel yet. I'll start keeping track now!"
            }

            messages = fallbackMessages
            summaryLabel = isThread
                ? `latest ${messages.length} thread messages`
                : `latest ${messages.length} messages`
            fallbackNote = timeframe.label
        }

        summaryStart = messages[0]?.createdAt ?? summaryStart

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
        footerNotes.push(`Analyzed ${result.usedMessages} message(s).`)

        const footer = footerNotes.length ? `_${footerNotes.join(' ')}_` : undefined
        return this.composeResponse(result.summary, footer)
    }

    private composeResponse(summary: string, footer?: string): string {
        if (!footer) {
            return summary
        }
        return `${summary}\n\n${footer}`
    }
}
