import { makeTownsBot } from '@towns-protocol/bot'
import { bin_toString } from '@towns-protocol/utils'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import commands from './commands'
import { registerHelpHandler } from './handlers/help'
import { registerMessageHandler } from './handlers/message'
import { registerMessageEditHandler } from './handlers/messageEdit'
import { registerRedactionHandler } from './handlers/redaction'
import { registerSummarizeHandler } from './handlers/summarize'
import { loadEventsSince } from './utils/miniblockLoader'
import { decryptStreamEvent } from './utils/streamDecryption'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

const debugStreamId = "20e38d1437e1b91bf6b6bc21d6a97b7a7a91ec763f9626e654657bbebec3eecb"
if (debugStreamId) {
    await dumpStreamMessages(debugStreamId)
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

        const timestampMs = typeof parsed.event.createdAtEpochMs === 'bigint'
            ? Number(parsed.event.createdAtEpochMs)
            : parsed.event.createdAtEpochMs
        const timestampIso = new Date(timestampMs).toISOString()
        const content = typeof cleartext === 'string' ? cleartext : bin_toString(cleartext)
        console.log(`[${timestampIso}] ${content}`)
    }
}
