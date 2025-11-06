import { formatUnits, parseUnits } from 'viem'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const DEFAULT_DECIMALS = 18
const DEFAULT_TOKEN_SYMBOL = 'USDC'
const DEFAULT_PRICE_PER_EXTRA_DAY = '1'
const DEFAULT_USD_PER_EXTRA_DAY = 1

const tokenDecimals = readIntEnv('SUMMARY_PAYMENT_TOKEN_DECIMALS', DEFAULT_DECIMALS)
const tokenSymbol = process.env.SUMMARY_PAYMENT_TOKEN_SYMBOL?.trim() || DEFAULT_TOKEN_SYMBOL
const expectedCurrency = process.env.SUMMARY_PAYMENT_TOKEN_ADDRESS?.trim()?.toLowerCase()
const pricePerDayRaw = process.env.SUMMARY_PAYMENT_AMOUNT_PER_DAY?.trim() || DEFAULT_PRICE_PER_EXTRA_DAY
const usdPerDay = readFloatEnv('SUMMARY_PAYMENT_USD_PER_DAY', DEFAULT_USD_PER_EXTRA_DAY)

const amountPerDay = parseAmount(pricePerDayRaw, tokenDecimals)

export type SummaryPaymentQuote = {
    extraDays: number
    requiredAmount: bigint
    usdCost: number
}

export function calculateSummaryPayment(durationMs: number): SummaryPaymentQuote {
    if (!Number.isFinite(durationMs) || durationMs <= DAY_IN_MS) {
        return {
            extraDays: 0,
            requiredAmount: 0n,
            usdCost: 0,
        }
    }

    const extraMs = durationMs - DAY_IN_MS
    const extraDays = Math.ceil(extraMs / DAY_IN_MS)

    return {
        extraDays,
        requiredAmount: amountPerDay * BigInt(extraDays),
        usdCost: extraDays * usdPerDay,
    }
}

export function getFreeSummaryWindowMs(): number {
    return DAY_IN_MS
}

export function getTokenSymbol(): string {
    return tokenSymbol
}

export function getExpectedCurrencyAddress(): string | undefined {
    return expectedCurrency
}

export function formatTokenAmount(amount: bigint): string {
    if (amount === 0n) {
        return '0'
    }
    const raw = formatUnits(amount, tokenDecimals)
    return trimTrailingZeros(raw)
}

export function formatUsd(amount: number): string {
    const safe = Number.isFinite(amount) ? amount : 0
    return `$${safe.toFixed(2)}`
}

export function describeDuration(durationMs: number): string {
    if (durationMs <= 0) {
        return '0 hours'
    }

    const days = durationMs / DAY_IN_MS
    if (days >= 1) {
        return `${days.toFixed(days >= 10 ? 0 : 1)} day${days === 1 ? '' : 's'}`
    }

    const hours = durationMs / (60 * 60 * 1000)
    if (hours >= 1) {
        return `${hours.toFixed(hours >= 10 ? 0 : 1)} hour${hours === 1 ? '' : 's'}`
    }

    const minutes = durationMs / (60 * 1000)
    return `${minutes.toFixed(0)} minute${minutes === 1 ? '' : 's'}`
}

function parseAmount(value: string, decimals: number): bigint {
    try {
        return parseUnits(value, decimals)
    } catch (error) {
        console.warn('Failed to parse SUMMARY_PAYMENT_AMOUNT_PER_DAY, defaulting to 1 token per day', error)
        return 10n ** BigInt(decimals)
    }
}

function trimTrailingZeros(input: string): string {
    if (!input.includes('.')) {
        return input
    }
    return input.replace(/\.\d*?0+$/, (match) => {
        const trimmed = match.replace(/0+$/, '')
        return trimmed === '.' ? '' : trimmed
    })
}

function readIntEnv(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : fallback
}

function readFloatEnv(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseFloat(raw)
    return Number.isFinite(parsed) ? parsed : fallback
}
