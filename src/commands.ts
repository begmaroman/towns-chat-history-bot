import type { PlainMessage, SlashCommand } from '@towns-protocol/proto'

const commands = [
    {
        name: 'help',
        description: 'Get help with bot commands',
    },
    {
        name: 'summarize',
        description: 'Summarize recent conversation history (e.g. "/summarize 24h")',
    },
] as const satisfies PlainMessage<SlashCommand>[]

export default commands
