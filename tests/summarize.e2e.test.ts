import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import type { BotHandler } from '@towns-protocol/bot'

import commands from '../src/commands'
import type { AppBot } from '../src/types'
import { registerHelpHandler } from '../src/handlers/help'
import { registerMessageHandler } from '../src/handlers/message'
import { registerMessageEditHandler } from '../src/handlers/messageEdit'
import { registerRedactionHandler } from '../src/handlers/redaction'
import { registerSummarizeHandler } from '../src/handlers/summarize'
import { clearMessages } from '../src/storage/messageStore'

type SlashCommandHandler = Parameters<AppBot['onSlashCommand']>[1]
type MessageHandler = Parameters<AppBot['onMessage']>[0]

const CHANNEL_ID = 'channel-1'
const SPACE_ID = 'space-1'
const BOT_ID: `0x${string}` = '0xb07b07b07b07b07b07b07b07b07b07b07b07b07'
const USER_ID: `0x${string}` = '0x1230000000000000000000000000000000000000'

type RecordedMessage = {
    channelId: string
    message: string
    opts?: Parameters<BotHandler['sendMessage']>[2]
    eventId: string
}

function createMockBot() {
    let slashCommandHandlers = new Map<string, SlashCommandHandler>()
    let messageHandler: MessageHandler | undefined
    let messageEditHandler: Parameters<AppBot['onMessageEdit']>[0] | undefined
    let redactionHandler: Parameters<AppBot['onRedaction']>[0] | undefined

    const bot = {
        botId: BOT_ID,
        onSlashCommand(command: (typeof commands)[number]['name'], handler: SlashCommandHandler) {
            slashCommandHandlers.set(command, handler)
        },
        onMessage(handler: MessageHandler) {
            messageHandler = handler
        },
        onMessageEdit(handler: Parameters<AppBot['onMessageEdit']>[0]) {
            messageEditHandler = handler
        },
        onRedaction(handler: Parameters<AppBot['onRedaction']>[0]) {
            redactionHandler = handler
        },
    } as unknown as AppBot

    return {
        bot,
        getSlashCommandHandler(command: (typeof commands)[number]['name']) {
            const handler = slashCommandHandlers.get(command)
            if (!handler) {
                throw new Error(`Slash command handler not registered for ${command}`)
            }
            return handler
        },
        getMessageHandler() {
            if (!messageHandler) {
                throw new Error('Message handler not registered')
            }
            return messageHandler
        },
        getMessageEditHandler() {
            return messageEditHandler
        },
        getRedactionHandler() {
            return redactionHandler
        },
        reset() {
            slashCommandHandlers = new Map()
            messageHandler = undefined
            messageEditHandler = undefined
            redactionHandler = undefined
        },
    }
}

function createActionRecorder() {
    const sentMessages: RecordedMessage[] = []
    let counter = 0

    const upsertMessage = (entry: RecordedMessage) => {
        const index = sentMessages.findIndex((m) => m.eventId === entry.eventId)
        if (index === -1) {
            sentMessages.push(entry)
        } else {
            sentMessages[index] = entry
        }
    }

    const handler = {
        async sendMessage(channelId: string, message: string, opts?: Parameters<BotHandler['sendMessage']>[2]) {
            const eventId = `sent-${++counter}`
            upsertMessage({ channelId, message, opts, eventId })
            return { eventId, prevMiniblockHash: new Uint8Array() }
        },
        async editMessage(
            channelId: string,
            eventId: string,
            message: string,
            opts?: Parameters<BotHandler['editMessage']>[3],
        ) {
            upsertMessage({ channelId, message, opts, eventId })
            return { eventId, prevMiniblockHash: new Uint8Array() }
        },
    } as unknown as BotHandler

    return {
        handler,
        sentMessages,
    }
}

const ORIGINAL_FETCH = globalThis.fetch

describe('summarize command', () => {
    beforeEach(() => {
        clearMessages()
        process.env.OPENAI_API_KEY = 'test-api-key'
    })

    afterEach(() => {
        clearMessages()
        if (ORIGINAL_FETCH) {
            globalThis.fetch = ORIGINAL_FETCH
        }
        delete process.env.OPENAI_API_KEY
    })

    it('summarizes messages within the requested timeframe', async () => {
        const mockFetchCalls: Array<{ url: Parameters<typeof fetch>[0]; init?: RequestInit }> = []
        globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
            mockFetchCalls.push({ url, init })
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: 'Summary content for timeframe.' } }],
                }),
                { status: 200 },
            )
        }) as typeof fetch

        const mockBot = createMockBot()
        registerHelpHandler(mockBot.bot)
        registerMessageHandler(mockBot.bot)
        registerMessageEditHandler(mockBot.bot)
        registerRedactionHandler(mockBot.bot)
        registerSummarizeHandler(mockBot.bot)

        const messageHandler = mockBot.getMessageHandler()
        const baseTime = Date.now()

        const messageEvent = {
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            message: 'Discussed release plan.',
            eventId: 'event-1',
            userId: USER_ID,
            createdAt: new Date(baseTime - 10 * 60 * 1000),
            replyId: undefined,
            threadId: undefined,
            mentions: [],
            isMentioned: false,
        }

        await messageHandler({} as BotHandler, messageEvent)

        const { handler, sentMessages } = createActionRecorder()
        const slashHandler = mockBot.getSlashCommandHandler('summarize')
        const slashEvent = {
            command: 'summarize' as const,
            args: ['30m'],
            userId: USER_ID,
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            createdAt: new Date(baseTime),
            eventId: 'slash-1',
            mentions: [],
            replyId: undefined,
            threadId: undefined,
        }

        await slashHandler(handler, slashEvent)

        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]?.message).toContain('**Summary (30m)**')
        expect(sentMessages[0]?.message).toContain('Summary content for timeframe.')
        expect(sentMessages[0]?.message).toContain('Analyzed 1 messages')
        expect(mockFetchCalls).toHaveLength(1)
        const body = JSON.parse(mockFetchCalls[0]?.init?.body as string)
        expect(body.messages[1].content).toContain('Discussed release plan.')
    })

    it('falls back to the most recent messages when timeframe is empty', async () => {
        const mockFetchCalls: Array<{ url: Parameters<typeof fetch>[0]; init?: RequestInit }> = []
        globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
            mockFetchCalls.push({ url, init })
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: 'Fallback summary content.' } }],
                }),
                { status: 200 },
            )
        }) as typeof fetch

        const mockBot = createMockBot()
        registerMessageHandler(mockBot.bot)
        registerSummarizeHandler(mockBot.bot)

        const messageHandler = mockBot.getMessageHandler()
        const baseTime = Date.now()

        await messageHandler({} as BotHandler, {
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            message: 'Legacy discussion.',
            eventId: 'event-legacy',
            userId: USER_ID,
            createdAt: new Date(baseTime - 2 * 60 * 60 * 1000),
            replyId: undefined,
            threadId: undefined,
            mentions: [],
            isMentioned: false,
        })

        const { handler, sentMessages } = createActionRecorder()
        const slashHandler = mockBot.getSlashCommandHandler('summarize')
        await slashHandler(handler, {
            command: 'summarize',
            args: ['30m'],
            userId: USER_ID,
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            createdAt: new Date(baseTime),
            eventId: 'slash-legacy',
            mentions: [],
            replyId: undefined,
            threadId: undefined,
        })

        expect(sentMessages).toHaveLength(1)
        const [response] = sentMessages
        expect(response?.message).toContain('**Summary (latest 1 messages)**')
        expect(response?.message).toContain('No activity detected in the past 30m.')
        expect(response?.message).toContain('Fallback summary content.')
        expect(mockFetchCalls).toHaveLength(1)
    })

    it('reports when no messages have been observed yet', async () => {
        const mockFetch = globalThis.fetch
        globalThis.fetch = ((async () => {
            throw new Error('Fetch should not be called when no messages are stored')
        }) as unknown as typeof fetch)

        const mockBot = createMockBot()
        registerSummarizeHandler(mockBot.bot)

        const { handler, sentMessages } = createActionRecorder()
        const slashHandler = mockBot.getSlashCommandHandler('summarize')
        await slashHandler(handler, {
            command: 'summarize',
            args: ['30m'],
            userId: USER_ID,
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            createdAt: new Date(),
            eventId: 'slash-empty',
            mentions: [],
            replyId: undefined,
            threadId: undefined,
        })

        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]?.message).toContain("I haven't seen any messages in this channel yet")
        globalThis.fetch = mockFetch
    })

    it('guides the user when timeframe parsing fails', async () => {
        const mockBot = createMockBot()
        registerSummarizeHandler(mockBot.bot)

        const { handler, sentMessages } = createActionRecorder()
        const slashHandler = mockBot.getSlashCommandHandler('summarize')
        await slashHandler(handler, {
            command: 'summarize',
            args: ['nonsense'],
            userId: USER_ID,
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            createdAt: new Date(),
            eventId: 'slash-invalid',
            mentions: [],
            replyId: undefined,
            threadId: undefined,
        })

        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]?.message).toContain('Unable to understand timeframe')
    })

    it('notes fallback when a timeframe was requested but empty', async () => {
        const mockFetchCalls: Array<{ url: Parameters<typeof fetch>[0]; init?: RequestInit }> = []
        globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
            mockFetchCalls.push({ url, init })
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: 'Fallback with timeframe.' } }],
                }),
                { status: 200 },
            )
        }) as typeof fetch

        const mockBot = createMockBot()
        registerSummarizeHandler(mockBot.bot)
        registerMessageHandler(mockBot.bot)

        const messageHandler = mockBot.getMessageHandler()
        const baseTime = Date.now() - 6 * 60 * 60 * 1000
        await messageHandler({} as BotHandler, {
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            message: 'Old update outside timeframe.',
            eventId: 'old-msg',
            userId: USER_ID,
            createdAt: new Date(baseTime),
            replyId: undefined,
            threadId: undefined,
            mentions: [],
            isMentioned: false,
        })

        const { handler, sentMessages } = createActionRecorder()
        const slashHandler = mockBot.getSlashCommandHandler('summarize')
        await slashHandler(handler, {
            command: 'summarize',
            args: ['1h'],
            userId: USER_ID,
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            createdAt: new Date(),
            eventId: 'slash-fallback',
            mentions: [],
            replyId: undefined,
            threadId: undefined,
        })

        expect(sentMessages).toHaveLength(1)
        const [response] = sentMessages
        expect(response?.message).toContain('latest 1 messages')
        expect(response?.message).toContain('Fallback with timeframe.')
        expect(response?.message).toContain('No activity detected in the past 1h')
        expect(mockFetchCalls).toHaveLength(1)
    })

    it('summarizes an entire thread when no duration is provided', async () => {
        const mockFetchCalls: Array<{ url: Parameters<typeof fetch>[0]; init?: RequestInit }> = []
        globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
            mockFetchCalls.push({ url, init })
            return new Response(
                JSON.stringify({
                    choices: [{ message: { content: 'Thread summary.' } }],
                }),
                { status: 200 },
            )
        }) as typeof fetch

        const mockBot = createMockBot()
        registerMessageHandler(mockBot.bot)
        registerSummarizeHandler(mockBot.bot)

        const messageHandler = mockBot.getMessageHandler()
        const baseTime = Date.now()

        // Root message
        await messageHandler({} as BotHandler, {
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            message: 'Initial question?',
            eventId: 'thread-root',
            userId: USER_ID,
            createdAt: new Date(baseTime - 60 * 60 * 1000),
            replyId: undefined,
            threadId: undefined,
            mentions: [],
            isMentioned: false,
        })

        // Thread replies
        await messageHandler({} as BotHandler, {
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            message: 'First reply with details.',
            eventId: 'thread-msg-1',
            userId: USER_ID,
            createdAt: new Date(baseTime - 30 * 60 * 1000),
            replyId: 'thread-root',
            threadId: 'thread-root',
            mentions: [],
            isMentioned: false,
        })

        await messageHandler({} as BotHandler, {
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            message: 'Second reply adding context.',
            eventId: 'thread-msg-2',
            userId: USER_ID,
            createdAt: new Date(baseTime - 10 * 60 * 1000),
            replyId: 'thread-root',
            threadId: 'thread-root',
            mentions: [],
            isMentioned: false,
        })

        const { handler, sentMessages } = createActionRecorder()
        const slashHandler = mockBot.getSlashCommandHandler('summarize')
        await slashHandler(handler, {
            command: 'summarize',
            args: [],
            userId: USER_ID,
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            createdAt: new Date(baseTime),
            eventId: 'slash-thread',
            mentions: [],
            replyId: undefined,
            threadId: 'thread-root',
        })

        expect(sentMessages).toHaveLength(1)
        const [response] = sentMessages
        expect(response?.message).toContain('**Summary (complete thread)**')
        expect(response?.message).toContain('Thread summary.')
        expect(response?.message).toContain('Analyzed 3 messages')
        expect(mockFetchCalls).toHaveLength(1)
    })

    it('surfaces OpenAI request failures gracefully', async () => {
        globalThis.fetch = ((async () => {
            throw new Error('Simulated OpenAI outage')
        }) as unknown as typeof fetch)

        const mockBot = createMockBot()
        registerMessageHandler(mockBot.bot)
        registerSummarizeHandler(mockBot.bot)

        const messageHandler = mockBot.getMessageHandler()
        await messageHandler({} as BotHandler, {
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            message: 'Message before failure.',
            eventId: 'failure-msg',
            userId: USER_ID,
            createdAt: new Date(),
            replyId: undefined,
            threadId: undefined,
            mentions: [],
            isMentioned: false,
        })

        const { handler, sentMessages } = createActionRecorder()
        const slashHandler = mockBot.getSlashCommandHandler('summarize')
        await slashHandler(handler, {
            command: 'summarize',
            args: [],
            userId: USER_ID,
            channelId: CHANNEL_ID,
            spaceId: SPACE_ID,
            createdAt: new Date(),
            eventId: 'slash-fail',
            mentions: [],
            replyId: undefined,
            threadId: undefined,
        })

        expect(sentMessages).toHaveLength(1)
        expect(sentMessages[0]?.message).toContain('Failed to generate summary')
        expect(sentMessages[0]?.message).toContain('Simulated OpenAI outage')
    })
})
