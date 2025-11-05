import { makeTownsBot } from '@towns-protocol/bot'
import { bin_fromHexString, bin_toString } from '@towns-protocol/utils'
import { fromJsonString, toJsonString } from '@bufbuild/protobuf'
import { unpackEnvelope, unpackMiniblock } from '@towns-protocol/sdk'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import commands from './commands'
import { registerHelpHandler } from './handlers/help'
import { registerMessageHandler } from './handlers/message'
import { registerMessageEditHandler } from './handlers/messageEdit'
import { registerRedactionHandler } from './handlers/redaction'
import { registerSummarizeHandler } from './handlers/summarize'
import {GroupEncryptionAlgorithmId} from "@towns-protocol/encryption/dist/olmLib";
import {SessionKeysSchema} from "@towns-protocol/proto";

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

// Getting current session
const streamIdHex = "20e38d1437e1b91bf6b6bc21d6a97b7a7a91ec763f9626e654657bbebec3eecb"
const streamId = bin_fromHexString(streamIdHex)
const appSvcClient = await bot.client.appServiceClient()
const sessionResp = await appSvcClient.getSession({
    appId: bin_fromHexString(bot.botId),
    identifier: {
        case: 'streamId',
        value: streamId,
    }
})

if (sessionResp.groupEncryptionSessions) {
    const parsedEvent = await unpackEnvelope(
      sessionResp.groupEncryptionSessions,
      {},
    )

    if (parsedEvent.event.payload.case !== 'userInboxPayload' ||
      parsedEvent.event.payload.value.content.case !== 'groupEncryptionSessions') {
        throw "Unexpected payload type in session response";
    }

    const sessions = parsedEvent.event.payload.value.content.value
    console.log("sessions", sessions)
    await bot.client.importGroupEncryptionSessions({
        streamId: streamIdHex,
        sessions: sessions,
    })

    const keys = Object.keys(sessions.ciphertexts)
    for (const key of keys) {
        const cleartext = await bot.client.crypto.decryptWithDeviceKey(sessions.ciphertexts[key], sessions.senderKey)
        const sessionKeys = fromJsonString(SessionKeysSchema, cleartext)

        await bot.client.crypto.importSessionKeys(streamIdHex, [{
            streamId: streamIdHex,
            sessionId: sessions.sessionIds[0],
            sessionKey: sessionKeys.keys[0],
            algorithm: sessions.algorithm as GroupEncryptionAlgorithmId,
        }])
    }

    const miniblocks = await bot.client.rpc.getMiniblocks({
        streamId: streamId,
        fromInclusive: 0n,
        toExclusive: 100n,
        omitSnapshots: true
    })

    for (let i = 0; i < miniblocks.miniblocks.length; i++) {
        const parsedEvents = await bot.client.unpackEnvelopes(miniblocks.miniblocks[i].events)

        for (const event of parsedEvents) {
            if (event.event.payload.case !== 'gdmChannelPayload' &&
              event.event.payload.case !== 'dmChannelPayload' &&
              event.event.payload.case !== 'channelPayload') {
                continue
            }

            if (event.event.payload.value.content.case !== 'message') {
                continue
            }

            const eventCleartext = await bot.client.crypto.decryptGroupEvent(
              streamIdHex,
              event.event.payload.value?.content.value,
            )

            console.log(bin_toString(eventCleartext as Uint8Array))
        }
    }

    // console.log(parsedEvent)
}

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
