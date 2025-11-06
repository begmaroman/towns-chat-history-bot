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

const DEFAULT_MODEL = process.env.OPENAI_SUMMARY_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
const OPENAI_ENDPOINT = process.env.OPENAI_API_ENDPOINT ?? 'https://api.openai.com/v1/chat/completions'

const SUMMARY_PROMPT_TEMPLATE = `Summarize the following Towns conversation starting from {{startIso}} ({{timeframeLabel}}) in {{scope}}.

Instructions:
- Keep tone neutral and professional.
- Format every user reference as <@userId> using the exact identifier provided.
- Use the complete userId when constructing <@userId> mentions; do not shorten or truncate.
- Treat the transcript as authoritative; do not invent details.
- If the content is sparse, state that explicitly.

Respond using this exact template (do not add or remove sections) defined between the triple backticks (send summary without triple backticks):

\`\`\`
Key Themes:
- ...
Action Items:
- <@userId> — ...
Open Questions:
- ...
\`\`\`

Transcript (JSON array for reference):
{{transcript}}
{{participantsNote}}
{{truncationNote}}`

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
    const prompt = buildPrompt({
        transcript,
        start: params.start,
        timeframeLabel: params.timeframeLabel,
        channelId: params.channelId,
        threadId: params.threadId,
        messageCount: transcript.messageCount,
    })

    const body = {
        model: params.model ?? DEFAULT_MODEL,
        temperature: 0.2,
        messages: [
            {
                role: 'system',
                content: 'You are an expert meeting summarizer. Write concise, structured summaries that highlight decisions, action items with owners, unresolved questions, sentiment (if relevant), and important context (if relevant). Keep tone neutral and professional.',
            },
            {
                role: 'user',
                content: prompt,
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
          params.transcript.participants.map((id) => `- ${id}`).join('\n')
        : ''

    return renderTemplate(SUMMARY_PROMPT_TEMPLATE, {
        startIso: params.start.toISOString(),
        timeframeLabel: params.timeframeLabel,
        scope,
        truncationNote,
        messageCount: params.messageCount.toString(),
        transcript: params.transcript.text,
        participantsNote,
    })
}

const DEFAULT_CHAR_LIMIT = 50_000

function buildTranscript(messages: PersistedMessage[], maxCharacters?: number): Transcript {
    const characterBudget = maxCharacters ?? DEFAULT_CHAR_LIMIT
    let truncated = false
    const participants = new Set<string>()
    const committedEntries: Record<string, unknown>[] = []

    for (const message of messages) {
        const entry = buildMessageEntry(message)
        committedEntries.push(entry)
        const projectedText = JSON.stringify(committedEntries, null, 2)
        if (projectedText.length > characterBudget) {
            committedEntries.pop()
            truncated = true
            break
        }
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
        id: message.eventId,
        timestamp: message.createdAt.toISOString(),
        participant: message.userId,
        message: normaliseWhitespace(message.message),
    }

    if (message.updatedAt) {
        entry.editedAt = message.updatedAt.toISOString()
    }

    const replyInfo = buildReplyMetadata(message)
    if (replyInfo) {
        entry.replyTo = replyInfo
    }

    return entry
}

function buildReplyMetadata(message: PersistedMessage,): { thread?: string; message?: string } | undefined {
    const { threadId, replyId } = message
    if (!threadId && !replyId) {
        return undefined
    }

    const metadata: {
        thread?: string
        message?: string
    } = {}

    if (threadId) {
        metadata.thread = threadId
    }

    if (replyId) {
        metadata.message = replyId
    }

    return Object.keys(metadata).length ? metadata : undefined
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

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/{{(\w+)}}/g, (_, key) => values[key] ?? '')
}
