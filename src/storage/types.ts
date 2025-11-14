import type { ParsedTimeframe } from '../utils/timeframe'

export type StoredMessage = {
    eventId: string
    channelId: string
    threadId?: string
    replyId?: string
    userId: string
    message: string
    createdAt: Date
    updatedAt?: Date
}

export type SaveMessageInput = Omit<StoredMessage, 'updatedAt'>

export type UpdateMessageInput = {
    eventId: string
    message: string
    editedAt: Date
}

export type MessageQuery = {
    channelId: string
    start: Date
    threadId?: string
    limit: number
}

export type ChannelStore = {
    byId: Map<string, StoredMessage>
    orderedIds: string[]
    earliestTimestamp?: number
}

export type PendingSummaryRequestRecord = {
    promptMessageId: string
    channelId: string
    threadId?: string
    replyThreadId: string
    timeframe: ParsedTimeframe
    requestedBy: string
}

export interface Storage {
    saveMessage(message: SaveMessageInput): Promise<void>
    updateMessageContent(channelId: string, message: UpdateMessageInput): Promise<void>
    removeMessage(channelId: string, eventId: string): Promise<void>
    getMessages(query: MessageQuery): Promise<StoredMessage[]>
    getRecentMessages(params: { channelId: string; threadId?: string; limit?: number }): Promise<StoredMessage[]>
    getEarliestTimestamp(channelId: string): Promise<number | undefined>
    bulkSaveMessages(channelId: string, messages: StoredMessage[]): Promise<void>
    savePendingSummaryRequest(request: PendingSummaryRequestRecord): Promise<void>
    getPendingSummaryRequest(promptMessageId: string): Promise<PendingSummaryRequestRecord | undefined>
    deletePendingSummaryRequest(promptMessageId: string): Promise<void>
    close(): void
}
