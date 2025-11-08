import type { StoredMessage } from '../storage/types'

export type SummarizeParams = {
    messages: StoredMessage[]
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

const SUMMARY_PROMPT_TEMPLATE = `Message Title: {{title}}
Summary Period (approx.): {{periodLabel}}
Scope: {{scope}}
Start Timestamp: {{startIso}} (request label: {{timeframeLabel}})
Messages Provided: {{messageCount}}
{{truncationInstruction}}

Instructions:
- Keep tone neutral and professional and keep the total summary short (focus on signal, not chronology).
- Capture only discussions that produced decisions, commitments, blockers, or next steps; skip casual chatter or question/answer exchanges that resolved immediately with no follow-up.
- Merge repetitive updates on the same topic into a single bullet.
- Format every user reference as <@userId> using the exact identifier provided (never shorten userIds).
- Treat the transcript as authoritative; do not invent details.
- If a section has no qualifying content, skip this section.
- If no discussions meet the decision/action/blocker criteria, respond with "No meaningful conversations captured during this timeframe." instead of the template below.
- If a truncation notice line is provided under the title, include it verbatim before the sections.

Transcript (JSON array for reference):
{{transcript}}
{{participantsNote}}

Section guidelines before you write:
- Key Themes: capture only decisions or impactful changes.
- Action Items: show the owner plus the next step or due date.
- Open Questions: include unresolved blockers that still require follow-up.

Respond using this exact template (first line must match the provided title; do not add or remove sections):

{{title}}{{truncationNoteLine}}
Key Themes:
- ...
Action Items:
- <@userId> — ...
Open Questions:
- ...
`

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
    })

    const body = {
        model: params.model ?? DEFAULT_MODEL,
        temperature: 0.2,
        messages: [
            {
                role: 'system',
                content:
                    'You are an expert meeting summarizer. Write concise, structured summaries that highlight decisions, action items with owners, unresolved questions, sentiment (if relevant), and important context (if relevant). Keep tone neutral and professional.',
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
}

type Transcript = {
    text: string
    messageCount: number
    truncated: boolean
    participants: string[]
    firstTimestamp?: Date
    lastTimestamp?: Date
}

function buildPrompt(params: PromptParams): string {
    const scope = params.threadId ? `thread (${params.threadId})` : `channel (${params.channelId})`
    const participantsNote = params.transcript.participants.length
        ? '\n\nParticipants (full userIds for mentions):\n' +
          params.transcript.participants.map((id) => `- ${id}`).join('\n')
        : ''
    const effectiveStart = params.transcript.firstTimestamp ?? params.start
    const periodLabel = formatSummaryPeriod(effectiveStart, new Date())
    const title = formatSummaryTitle(periodLabel)
    const truncationInstruction = params.transcript.truncated
        ? '- Context limit reached; only the most recent portion of the transcript was provided.'
        : ''
    const truncationNoteLine = params.transcript.truncated
        ? '\n_Truncation Notice: Only the most recent portion of the transcript was available due to size limits._'
        : ''

    return renderTemplate(SUMMARY_PROMPT_TEMPLATE, {
        startIso: params.start.toISOString(),
        timeframeLabel: params.timeframeLabel,
        scope,
        transcript: params.transcript.text,
        participantsNote,
        title,
        periodLabel,
        messageCount: params.transcript.messageCount.toString(),
        truncationInstruction,
        truncationNoteLine,
    })
}

const DEFAULT_CHAR_LIMIT = 100_000

function buildTranscript(messages: StoredMessage[], maxCharacters?: number): Transcript {
    const characterBudget = maxCharacters ?? DEFAULT_CHAR_LIMIT
    let truncated = false
    const participants = new Set<string>()
    const committedEntries: Record<string, unknown>[] = []
    let firstTimestamp: Date | undefined
    let lastTimestamp: Date | undefined

    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index]
        const entry = buildMessageEntry(message)
        const projectedEntries = [entry, ...committedEntries]
        const projectedText = JSON.stringify(projectedEntries)
        if (projectedText.length > characterBudget) {
            truncated = true
            break
        }
        committedEntries.unshift(entry)
        participants.add(message.userId)
        if (!lastTimestamp) {
            lastTimestamp = message.createdAt
        }
        firstTimestamp = message.createdAt
    }

    return {
        text: JSON.stringify(committedEntries),
        messageCount: committedEntries.length,
        truncated,
        participants: Array.from(participants),
        firstTimestamp,
        lastTimestamp,
    }
}

function buildMessageEntry(message: StoredMessage): Record<string, unknown> {
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

function buildReplyMetadata(message: StoredMessage): { thread?: string; message?: string } | undefined {
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

function normaliseWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
}

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/{{(\w+)}}/g, (_, rawKey) => {
        const key = rawKey as keyof typeof values
        return values[key] ?? ''
    })
}

const RELATIVE_PERIODS = [
    { label: 'day', ms: 24 * 60 * 60 * 1000 },
    { label: 'hour', ms: 60 * 60 * 1000 },
    { label: 'minute', ms: 60 * 1000 },
]

function formatSummaryPeriod(start: Date, end: Date): string {
    const diffMs = Math.max(0, end.getTime() - start.getTime())
    for (const period of RELATIVE_PERIODS) {
        const value = diffMs / period.ms
        if (value >= 1) {
            const rounded = Math.max(1, Math.round(value))
            const suffix = rounded === 1 ? '' : 's'
            return `last ${rounded} ${period.label}${suffix}`
        }
    }
    return 'last few seconds'
}

function formatSummaryTitle(periodLabel: string): string {
    return `**Summary — ${periodLabel}**`
}
