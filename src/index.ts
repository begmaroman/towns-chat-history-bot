import {makeTownsBot} from '@towns-protocol/bot'
import {Hono} from 'hono'
import {logger} from 'hono/logger'
import commands from './commands'
import {registerHelpHandler} from './handlers/help'
import {registerMessageHandler} from './handlers/message'
import {registerMessageEditHandler} from './handlers/messageEdit'
import {registerRedactionHandler} from './handlers/redaction'
import {registerSummarizeHandler} from './handlers/summarize'
import {registerTipHandler} from './handlers/tip'

const bot = await makeTownsBot(process.env.APP_PRIVATE_DATA!, process.env.JWT_SECRET!, {
    commands,
})

registerHelpHandler(bot)
registerSummarizeHandler(bot)
registerMessageHandler(bot)
registerMessageEditHandler(bot)
registerRedactionHandler(bot)
registerTipHandler(bot)

const { jwtMiddleware, handler } = bot.start()

const app = new Hono()
app.use(logger())
app.post('/webhook', jwtMiddleware, handler)

export default app
