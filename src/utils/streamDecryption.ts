import { fromJsonString } from '@bufbuild/protobuf'
import { ParsedEvent, errorContains } from '@towns-protocol/sdk'
import { bin_fromHexString } from '@towns-protocol/utils'
import { GroupEncryptionAlgorithmId, parseGroupEncryptionAlgorithmId } from '@towns-protocol/encryption/dist/olmLib'
import {EncryptedData, Err, UserInboxPayload_GroupEncryptionSessions} from '@towns-protocol/proto'
import { SessionKeysSchema } from '@towns-protocol/proto'

import type { AppBot } from '../types'

const inflightInitialisations = new Map<string, Promise<void>>()
const streamSessionCache = new Map<string, number>()
const STREAM_SESSION_TTL_MS = 180_000 // 3 minutes session cache TTL
const STREAM_SESSION_NOT_FOUND_MAX_RETRIES = 4
const STREAM_SESSION_NOT_FOUND_BACKOFF_MS = 1000

export async function decryptStreamEvent(
  bot: AppBot,
  streamIdHex: string,
  event: ParsedEvent,
): Promise<string | Uint8Array | undefined> {
    const encryptedContent = getEncryptedEventContent(event)
    if (!encryptedContent) {
        return undefined
    }

    await ensureStreamKeys(bot, streamIdHex)
    return bot.client.crypto.decryptGroupEvent(streamIdHex, encryptedContent)
}

export function getEncryptedEventContent(event: ParsedEvent): EncryptedData | undefined {
    const payload = event.event.payload
    switch (payload.case) {
        case 'channelPayload':
        case 'dmChannelPayload':
        case 'gdmChannelPayload': {
            const content = payload.value.content
            if (content.case !== 'message') {
                return undefined
            }
            return content.value
        }
        default:
            return undefined
    }
}

async function ensureStreamKeys(bot: AppBot, streamIdHex: string): Promise<void> {
    if (isCacheFresh(streamIdHex)) {
        return
    }

    const existing = inflightInitialisations.get(streamIdHex)
    if (existing) {
        await existing
        if (isCacheFresh(streamIdHex)) {
            return
        }
        // fallthrough to refresh if cache expired after awaiting
    }

    const loadPromise = loadStreamSessions(bot, streamIdHex)
    inflightInitialisations.set(streamIdHex, loadPromise)

    try {
        await loadPromise
        streamSessionCache.set(streamIdHex, Date.now() + STREAM_SESSION_TTL_MS)
    } finally {
        inflightInitialisations.delete(streamIdHex)
    }
}

async function loadStreamSessions(bot: AppBot, streamIdHex: string): Promise<void> {
    const streamIdBytes = bin_fromHexString(streamIdHex)
    const appServiceClient = await bot.client.appServiceClient()
    const appIdBytes = bin_fromHexString(bot.botId)

    const sessionResponse = await retryStreamSessionLoad(() =>
        appServiceClient.getSession({
            appId: appIdBytes,
            identifier: {
                case: 'streamId',
                value: streamIdBytes,
            },
        }),
    )

    if (!sessionResponse.groupEncryptionSessions) {
        return
    }

    const parsedSession = await bot.client.unpackEnvelope(sessionResponse.groupEncryptionSessions)
    if (
        parsedSession.event.payload.case !== 'userInboxPayload' ||
        parsedSession.event.payload.value.content.case !== 'groupEncryptionSessions'
    ) {
        throw new Error('Unexpected payload in group encryption session response')
    }

    // Delete existing keys first
    await bot.client.crypto.cryptoStore.deleteHybridGroupSessions(streamIdHex)

    const sessions = parsedSession.event.payload.value.content.value
    await bot.client.importGroupEncryptionSessions({
        streamId: streamIdHex,
        sessions,
    })

    const algorithmResult = parseGroupEncryptionAlgorithmId(
        sessions.algorithm,
        GroupEncryptionAlgorithmId.GroupEncryption,
    )
    if (algorithmResult.kind !== 'matched') {
        throw new Error(`Unsupported group encryption algorithm: ${sessions.algorithm}`)
    }

    const sessionKeyImports = await buildSessionKeyImports(bot, streamIdHex, sessions, algorithmResult.value)
    if (sessionKeyImports.length > 0) {
        await bot.client.crypto.importSessionKeys(streamIdHex, sessionKeyImports)
    }
}

async function buildSessionKeyImports(
    bot: AppBot,
    streamIdHex: string,
    sessions: UserInboxPayload_GroupEncryptionSessions,
    algorithm: GroupEncryptionAlgorithmId,
): Promise<
    Array<{
        streamId: string
        sessionId: string
        sessionKey: string
        algorithm: GroupEncryptionAlgorithmId
    }>
> {
    const sessionIdToKey = new Map<string, string>()

    const entries = Object.entries(sessions.ciphertexts)
    for (const [, ciphertext] of entries) {
        const cleartext = await bot.client.crypto.decryptWithDeviceKey(ciphertext, sessions.senderKey)
        const parsed = fromJsonString(SessionKeysSchema, cleartext)
        const keys = parsed.keys ?? []
        const pairCount = Math.min(keys.length, sessions.sessionIds.length)

        for (let index = 0; index < pairCount; index++) {
            const sessionId = sessions.sessionIds[index]
            const sessionKey = keys[index]
            if (sessionKey) {
                sessionIdToKey.set(sessionId, sessionKey)
            }
        }
    }

    return Array.from(sessionIdToKey.entries()).map(([sessionId, sessionKey]) => ({
        streamId: streamIdHex,
        sessionId,
        sessionKey,
        algorithm,
    }))
}

function isCacheFresh(streamId: string): boolean {
    const expiry = streamSessionCache.get(streamId)
    if (expiry === undefined) {
        return false
    }
    if (Date.now() <= expiry) {
        return true
    }
    streamSessionCache.delete(streamId)
    return false
}

async function retryStreamSessionLoad<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try {
            return await operation()
        } catch (error) {
            const shouldRetry = errorContains(error, Err.NOT_FOUND) && attempt < STREAM_SESSION_NOT_FOUND_MAX_RETRIES
            if (!shouldRetry) {
                throw error
            }
            const delay = STREAM_SESSION_NOT_FOUND_BACKOFF_MS * 2 ** attempt
            await delayMs(delay)
        }
    }
}

function delayMs(duration: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, duration))
}
