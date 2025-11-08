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
    limit?: number
}

export type ChannelStore = {
    byId: Map<string, StoredMessage>
    orderedIds: string[]
    earliestTimestamp?: number
}

export interface MessageStorage {
    saveMessage(message: SaveMessageInput): void
    updateMessageContent(channelId: string, message: UpdateMessageInput): void
    removeMessage(channelId: string, eventId: string): void
    getMessages(query: MessageQuery): StoredMessage[]
    getRecentMessages(params: { channelId: string; threadId?: string; limit?: number }): StoredMessage[]
    clearMessages(): void
    getEarliestTimestamp(channelId: string): number | undefined
    bulkSaveMessages(channelId: string, messages: StoredMessage[]): void
}
