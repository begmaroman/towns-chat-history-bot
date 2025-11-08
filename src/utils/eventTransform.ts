import type { ParsedEvent } from '@towns-protocol/sdk'
import type { StoredMessage } from '../storage/types'
import type { AppBot } from '../types'
import { decryptStreamEvent } from './streamDecryption'
import { parseChannelMessage, formatCleartext } from './messageParsing'

export async function transformEventToPersistedMessage(
    bot: AppBot,
    streamId: string,
    event: ParsedEvent
): Promise<StoredMessage | undefined> {
    const cleartext = await decryptStreamEvent(bot, streamId, event)
    if (!cleartext) {
        return undefined
    }

    const parsedMessage = parseChannelMessage(cleartext)
    const content = formatCleartext(cleartext, parsedMessage)

    const threadId = parsedMessage?.payload.case === 'post' ? parsedMessage.payload.value.threadId : undefined
    const replyId = parsedMessage?.payload.case === 'post' ? parsedMessage.payload.value.replyId : undefined

    const createdAt = deriveCreatedAt(event)

    return {
        eventId: event.hashStr,
        channelId: streamId,
        threadId,
        replyId,
        userId: event.creatorUserId,
        message: content,
        createdAt: createdAt
    }
}

export async function transformEventsToPersistedMessages(
    bot: AppBot,
    streamId: string,
    events: ParsedEvent[]
): Promise<StoredMessage[]> {
    const messages: StoredMessage[] = []

    for (const event of events) {
        const message = await transformEventToPersistedMessage(bot, streamId, event)
        if (message) {
            messages.push(message)
        }
    }

    return messages
}

function deriveCreatedAt(event: ParsedEvent): Date {
    const rawTimestamp = event.event.createdAtEpochMs

    if (typeof rawTimestamp === 'bigint') {
        const numeric = Number(rawTimestamp)
        if (Number.isFinite(numeric)) {
            return new Date(numeric)
        }
        return new Date()
    }

    if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
        return new Date(rawTimestamp)
    }

    return new Date()
}
