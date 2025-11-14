import { makeTownsBot } from '@towns-protocol/bot'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import commands from './commands'
import { registerHelpHandler } from './handlers/help'
import { registerMessageHandler } from './handlers/message'
import { registerMessageEditHandler } from './handlers/messageEdit'
import { registerRedactionHandler } from './handlers/redaction'
import { registerSummarizeHandler } from './handlers/summarize'
import { InMemoryStorage } from './storage/inmem'
import { RedisStorage } from './storage/redis'
import type { Storage } from './storage/types'
import { DefaultSummaryService } from './services/summary'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

const redisUrl = process.env.REDIS_URL?.trim()
const storage: Storage = redisUrl ? new RedisStorage(redisUrl) : new InMemoryStorage()

const summaryService = new DefaultSummaryService(bot, storage)

registerHelpHandler(bot)
registerSummarizeHandler(bot, storage, summaryService)
registerMessageHandler(bot, storage)
registerMessageEditHandler(bot, storage)
registerRedactionHandler(bot, storage)

const { jwtMiddleware, handler } = bot.start()

const app = new Hono()
app.use(logger())
app.post('/webhook', jwtMiddleware, handler)

export default app
