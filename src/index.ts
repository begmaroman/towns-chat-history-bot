import {makeTownsBot} from '@towns-protocol/bot'
import {Hono} from 'hono'
import {logger} from 'hono/logger'
import commands from './commands'
import {registerHelpHandler} from './handlers/help'
import {registerMessageHandler} from './handlers/message'
import {registerMessageEditHandler} from './handlers/messageEdit'
import {registerRedactionHandler} from './handlers/redaction'
import {registerSummarizeHandler} from './handlers/summarize'
import { dumpStreamMessages } from './utils/streamDebug'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

// await dumpStreamMessages(bot, "20e38d1437e1b91bf6b6bc21d6a97b7a7a91ec763f9626e654657bbebec3eecb")

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
