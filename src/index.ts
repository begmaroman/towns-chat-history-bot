import { makeTownsBot } from '@towns-protocol/bot'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import commands from './commands'
import { registerHelpHandler } from './handlers/help'
import { registerMessageHandler } from './handlers/message'
import { registerMessageEditHandler } from './handlers/messageEdit'
import { registerRedactionHandler } from './handlers/redaction'
import { registerSummarizeHandler } from './handlers/summarize'
import { InMemoryMessageStorage } from './storage/inmem'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

const messageStorage = new InMemoryMessageStorage()

registerHelpHandler(bot)
registerSummarizeHandler(bot, messageStorage)
registerMessageHandler(bot, messageStorage)
registerMessageEditHandler(bot, messageStorage)
registerRedactionHandler(bot, messageStorage)

const { jwtMiddleware, handler } = bot.start()

const app = new Hono()
app.use(logger())
app.post('/webhook', jwtMiddleware, handler)

export default app
