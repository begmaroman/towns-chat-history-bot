export type ParsedTimeframe = {
    start: Date
    label: string
}

const UNIT_TO_MS: Record<string, number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
}

const NORMALISE_PATTERNS: Array<[RegExp, string]> = [
    [/hours?/, 'h'],
    [/minutes?/, 'm'],
    [/seconds?/, 's'],
    [/days?/, 'd'],
    [/weeks?/, 'w'],
]

const IGNORED_WORDS = ['last', 'past', 'for', 'the', 'in', 'over', 'about']

export function parseTimeframe(input?: string, now = new Date()): ParsedTimeframe | null {
    const label = input?.trim() ?? ''
    const cleanedInput = normaliseInput(label)
    const segments = [...cleanedInput.matchAll(/(\d+)([smhdw])/g)]

    if (!segments.length) {
        return null
    }

    const totalMs = segments.reduce((acc, match) => {
        const value = Number.parseInt(match[1] ?? '0', 10)
        const unit = match[2]
        const unitMs = unit ? UNIT_TO_MS[unit] ?? 0 : 0
        return acc + value * unitMs
    }, 0)

    if (!Number.isFinite(totalMs) || totalMs <= 0) {
        return null
    }

    const start = new Date(now.getTime() - totalMs)

    return {
        start,
        label: label || formatLabel(totalMs),
    }
}

function normaliseInput(input: string): string {
    if (!input) {
        return ''
    }

    let result = input
        .toLowerCase()
        .split(/\s+/)
        .filter((word) => !IGNORED_WORDS.includes(word))
        .join(' ')

    for (const [pattern, replacement] of NORMALISE_PATTERNS) {
        result = result.replace(pattern, replacement)
    }

    result = result.replace(/\s+/g, '')

    return result
}

function formatLabel(durationMs: number): string {
    if (durationMs >= UNIT_TO_MS.d && durationMs % UNIT_TO_MS.d === 0) {
        const days = durationMs / UNIT_TO_MS.d
        return pluralise(days, 'day')
    }
    if (durationMs >= UNIT_TO_MS.h && durationMs % UNIT_TO_MS.h === 0) {
        const hours = durationMs / UNIT_TO_MS.h
        return pluralise(hours, 'hour')
    }
    if (durationMs >= UNIT_TO_MS.m && durationMs % UNIT_TO_MS.m === 0) {
        const minutes = durationMs / UNIT_TO_MS.m
        return pluralise(minutes, 'minute')
    }
    return `${Math.round(durationMs / UNIT_TO_MS.m)} minutes`
}

function pluralise(value: number, unit: string): string {
    const rounded = Number(value.toFixed(2))
    const trimmed = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toString()
    return `${trimmed} ${unit}${rounded === 1 ? '' : 's'}`
}
