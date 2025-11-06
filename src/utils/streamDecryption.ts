import { fromJsonString } from '@bufbuild/protobuf'
import type { ParsedEvent } from '@towns-protocol/sdk'
import { bin_fromHexString } from '@towns-protocol/utils'
import { GroupEncryptionAlgorithmId, parseGroupEncryptionAlgorithmId } from '@towns-protocol/encryption/dist/olmLib'
import type { EncryptedData, UserInboxPayload_GroupEncryptionSessions } from '@towns-protocol/proto'
import { SessionKeysSchema } from '@towns-protocol/proto'

import type { AppBot } from '../types'

const initializedStreams = new Set<string>()
const inflightInitialisations = new Map<string, Promise<void>>()

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
    if (initializedStreams.has(streamIdHex)) {
        return
    }

    const existing = inflightInitialisations.get(streamIdHex)
    if (existing) {
        await existing
        return
    }

    const loadPromise = loadStreamSessions(bot, streamIdHex)
    inflightInitialisations.set(streamIdHex, loadPromise)

    try {
        await loadPromise
        initializedStreams.add(streamIdHex)
    } finally {
        inflightInitialisations.delete(streamIdHex)
    }
}

async function loadStreamSessions(bot: AppBot, streamIdHex: string): Promise<void> {
    const streamIdBytes = bin_fromHexString(streamIdHex)
    const appServiceClient = await bot.client.appServiceClient()
    const sessionResponse = await appServiceClient.getSession({
        appId: bin_fromHexString(bot.botId),
        identifier: {
            case: 'streamId',
            value: streamIdBytes,
        },
    })

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
