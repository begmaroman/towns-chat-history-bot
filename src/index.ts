import {fromJsonString, fromBinary} from '@bufbuild/protobuf'
import {makeTownsBot} from '@towns-protocol/bot'
import {bin_toHexString, bin_toString} from '@towns-protocol/utils'
import {Hono} from 'hono'
import {logger} from 'hono/logger'
import commands from './commands'
import {registerHelpHandler} from './handlers/help'
import {registerMessageHandler} from './handlers/message'
import {registerMessageEditHandler} from './handlers/messageEdit'
import {registerRedactionHandler} from './handlers/redaction'
import {registerSummarizeHandler} from './handlers/summarize'
import {ChannelMessage, ChannelMessageSchema, MessageInteractionType} from '@towns-protocol/proto'
import {loadEventsSince} from './utils/miniblockLoader'
import {decryptStreamEvent, getEncryptedEventContent} from './utils/streamDecryption'
import type {PersistedMessage} from './storage/messageStore'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

await dumpStreamMessages("20e38d1437e1b91bf6b6bc21d6a97b7a7a91ec763f9626e654657bbebec3eecb")

registerHelpHandler(bot)
registerSummarizeHandler(bot)
registerMessageHandler(bot)
registerMessageEditHandler(bot)
registerRedactionHandler(bot)

const { jwtMiddleware, handler } = bot.start()

const app = new Hono()
app.use(logger())
app.post('/webhook', jwtMiddleware, handler)

export default app

async function dumpStreamMessages(streamIdHex: string) {
    if (!streamIdHex) {
        throw new Error('DEBUG_STREAM_ID must be a non-empty hex string')
    }

    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000)
    const events = await loadEventsSince(bot, streamIdHex, twelveHoursAgo)

    for (const parsed of events) {
        const cleartext = await decryptStreamEvent(bot, streamIdHex, parsed)
        if (!cleartext) {
            continue
        }

        const tags = parsed.event.tags
        const interactionType = tags?.messageInteractionType
        const threadIdFromTags = tags?.threadId ? bin_toHexString(tags.threadId) : undefined
        const isReply = interactionType === MessageInteractionType.REPLY
        const isThreadReply = Boolean(threadIdFromTags)

        const encryptedContent = getEncryptedEventContent(parsed)
        const replyFromEnvelope = encryptedContent?.refEventId
        const timestampMs = typeof parsed.event.createdAtEpochMs === 'bigint'
            ? Number(parsed.event.createdAtEpochMs)
            : parsed.event.createdAtEpochMs
        const timestampIso = new Date(timestampMs).toISOString()
        const parsedMessage = parseChannelMessage(cleartext)
        const threadIdFromPayload = parsedMessage?.payload.case === 'post' ? parsedMessage.payload.value.threadId : undefined
        const inlineReplyId = parsedMessage?.payload.case === 'post' ? parsedMessage.payload.value.replyId : undefined
        const threadId = threadIdFromTags ?? threadIdFromPayload
        const content = formatCleartext(cleartext, parsedMessage)
        const replyTargetId =
            replyFromEnvelope ??
            (isThreadReply ? threadId : undefined) ??
            inlineReplyId

        let storedThreadId = threadId
        let storedReplyId = replyTargetId

        if (isReply) {
            if (isThreadReply) {
                storedReplyId = undefined
                storedThreadId = threadId
            } else {
                storedReplyId = replyTargetId
                storedThreadId = undefined
            }
        }

        const stored: PersistedMessage = {
            eventId: parsed.hashStr,
            channelId: streamIdHex,
            threadId: storedThreadId,
            replyId: storedReplyId,
            userId: parsed.creatorUserId,
            message: content,
            createdAt: new Date(timestampMs),
        }

        const replyContext = isReply ? (isThreadReply ? 'thread reply' : 'inline reply') : undefined
        console.log(`[${timestampIso}]${replyContext && replyTargetId ? ` (${replyContext} → ${replyTargetId})` : ''}`, stored)
    }
}

function formatCleartext(cleartext: string | Uint8Array, parsed?: ReturnType<typeof parseChannelMessage>): string {
    if (parsed?.payload.case === 'post' && parsed.payload.value.content.case === 'text') {
        return parsed.payload.value.content.value.body
    }
    return typeof cleartext === 'string' ? cleartext : bin_toString(cleartext)
}

function parseChannelMessage(cleartext: string | Uint8Array) {
    let channelMessage: ChannelMessage
    if (typeof cleartext === 'string') {
        channelMessage = fromJsonString(
          ChannelMessageSchema,
          cleartext,
        )
    } else {
        channelMessage = fromBinary(ChannelMessageSchema, cleartext)
    }

    return channelMessage
}
