import type { Bot } from '@towns-protocol/bot'

import commands from './commands'

export type AppBot = Bot<typeof commands>
