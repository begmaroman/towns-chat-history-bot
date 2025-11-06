import type { PersistedMessage } from '../storage/messageStore'

export type SummarizeParams = {
    messages: PersistedMessage[]
    timeframeLabel: string
    start: Date
    channelId: string
    threadId?: string
    model?: string
    maxCharacters?: number
}

export type SummarizeResult = {
    summary: string
    truncated: boolean
    usedMessages: number
}

const DEFAULT_MODEL = process.env.OPENAI_SUMMARY_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini'
const OPENAI_ENDPOINT = process.env.OPENAI_API_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions'

export async function summarizeConversation(params: SummarizeParams): Promise<SummarizeResult> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
        throw new Error('Missing OpenAI API key. Set OPENAI_API_KEY environment variable.')
    }

    if (!params.messages.length) {
        return {
            summary: 'No messages captured during the requested timeframe.',
            truncated: false,
            usedMessages: 0,
        }
    }

    const transcript = buildTranscript(params.messages, params.maxCharacters)

    console.log(transcript)

    const body = {
        model: params.model ?? DEFAULT_MODEL,
        temperature: 0.2,
        messages: [
            {
                role: 'system',
                content:
                    'You are an expert meeting summarizer. Write concise, structured summaries that highlight decisions, action items with owners, unresolved questions, sentiment, and important context. Keep tone neutral and professional.',
            },
            {
                role: 'user',
                content: buildPrompt({
                    transcript,
                    start: params.start,
                    timeframeLabel: params.timeframeLabel,
                    channelId: params.channelId,
                    threadId: params.threadId,
                    messageCount: transcript.messageCount,
                }),
            },
        ],
    }

    const response = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
    }

    const summary = data.choices?.[0]?.message?.content?.trim()
    if (!summary) {
        throw new Error('OpenAI returned an empty response')
    }

    return {
        summary,
        truncated: transcript.truncated,
        usedMessages: transcript.messageCount,
    }
}

type PromptParams = {
    transcript: Transcript
    timeframeLabel: string
    start: Date
    channelId: string
    threadId?: string
    messageCount: number
}

type Transcript = {
    text: string
    messageCount: number
    truncated: boolean
    participants: string[]
}

function buildPrompt(params: PromptParams): string {
    const scope = params.threadId ? `thread (${params.threadId})` : `channel (${params.channelId})`
    const truncationNote = params.transcript.truncated
        ? '\n\nNote: Older messages beyond the character budget were not included.'
        : ''
    const participantsNote = params.transcript.participants.length
        ? '\n\nParticipants (full userIds for mentions):\n' +
          params.transcript.participants.map((id) => `- <@${id}>`).join('\n')
        : ''

    return (
        `Summarize the following Towns conversation starting from ${params.start.toISOString()} (${params.timeframeLabel}) in ${scope}.` +
        '\n\nInclude:' +
        '\n- Begin the summary with a short descriptive title (6 words or fewer) on its own line before any other content' +
        '\n- Key themes and decisions' +
        '\n- Action items with owners (format owners as <@userId>)' +
        '\n- Open questions or follow-ups' +
        '\n- Sentiment or tone shifts if notable' +
        '\n- Format every user reference as <@userId> instead of a plain address' +
        '\n- Use the complete userId when constructing <@userId> mentions; do not shorten or truncate' +
        '\n\nIf the content is sparse, mention that explicitly.' +
        truncationNote +
        `\n\nMessages provided (${params.messageCount}):\n` +
        params.transcript.text +
        participantsNote
    )
}

const DEFAULT_CHAR_LIMIT = 20_000

function buildTranscript(messages: PersistedMessage[], maxCharacters?: number): Transcript {
    const characterBudget = maxCharacters ?? DEFAULT_CHAR_LIMIT
    let truncated = false
    const participants = new Set<string>()
    const committedEntries: Record<string, unknown>[] = []

    for (let index = 0; index < messages.length; index++) {
        const message = messages[index]
        const entry = buildMessageEntry(message)

        const projectedEntries = [...committedEntries, entry]
        const projectedText = JSON.stringify(projectedEntries, null, 2)
        if (projectedText.length > characterBudget) {
            truncated = true
            break
        }

        committedEntries.push(entry)
        participants.add(message.userId)
    }

    return {
        text: JSON.stringify(committedEntries),
        messageCount: committedEntries.length,
        truncated,
        participants: Array.from(participants),
    }
}

function buildMessageEntry(message: PersistedMessage): Record<string, unknown> {
    const entry: Record<string, unknown> = {
        id: shortenId(message.eventId),
        timestamp: message.createdAt.toISOString(),
        author: shortenId(message.userId),
        message: normaliseWhitespace(message.message),
    }

    if (message.updatedAt) {
        entry.editedAt = message.updatedAt.toISOString()
    }

    const replyMetadata = buildReplyMetadata(message)
    if (replyMetadata) {
        entry.replyTo = replyMetadata
    }

    return entry
}

function buildReplyMetadata(message: PersistedMessage): { threadId?: string; replyId?: string } | undefined {
    const { threadId, replyId } = message
    if (!threadId && !replyId) {
        return undefined
    }

    const result: {
        threadId?: string
        replyId?: string
    } = {}

    if (threadId) {
        result.threadId = threadId
    }

    if (replyId) {
        result.replyId = replyId
    }

    return Object.keys(result).length ? result : undefined
}

function shortenId(id: string, length = 8): string {
    if (!id) {
        return id
    }
    const clean = id.startsWith('0x') ? id : `0x${id}`
    if (clean.length <= length + 2) {
        return clean
    }
    const prefix = clean.slice(0, Math.ceil((length - 1) / 2))
    const suffix = clean.slice(-Math.floor((length - 1) / 2))
    return `${prefix}…${suffix}`
}

function normaliseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

function makeLabel(index: number): string {
    const base = String(index).padStart(3, '0')
    return `m${base}`
}
