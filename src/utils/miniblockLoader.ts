import type { ParsedEvent } from '@towns-protocol/sdk'
import { bin_fromHexString } from '@towns-protocol/utils'

import type { AppBot } from '../types'

const DEFAULT_BATCH_SIZE = 128n

export type LoadEventsSinceOptions = {
    batchSize?: number
}

export async function loadEventsSince(
    bot: AppBot,
    streamIdHex: string,
    since: Date,
    options?: LoadEventsSinceOptions,
): Promise<ParsedEvent[]> {
    if (!streamIdHex) {
        throw new Error('Stream ID cannot be empty')
    }

    const thresholdMs = since.getTime()
    if (!Number.isFinite(thresholdMs)) {
        throw new Error('Invalid date provided for miniblock loading')
    }

    const batchSize = normalizeBatchSize(options?.batchSize)
    const streamBytes = bin_fromHexString(streamIdHex)
    const info = await bot.client.getMiniblockInfo(streamIdHex)
    let toExclusive = info.miniblockNum + 1n

    if (toExclusive <= 0n) {
        return []
    }

    const events: ParsedEvent[] = []
    let reachedOlderBoundary = false

    while (toExclusive > 0n) {
        const fromInclusive = toExclusive > batchSize ? toExclusive - batchSize : 0n

        const { miniblocks, terminus } = await bot.client.rpc.getMiniblocks({
            streamId: streamBytes,
            fromInclusive,
            toExclusive,
            omitSnapshots: true,
        })

        for (const miniblock of miniblocks) {
            const parsedEvents = await bot.client.unpackEnvelopes(miniblock.events)
            for (const event of parsedEvents) {
                const createdAt = eventTimestampMs(event)
                if (createdAt >= thresholdMs) {
                    events.push(event)
                } else {
                    reachedOlderBoundary = true
                }
            }
        }

        if (fromInclusive === 0n || terminus || reachedOlderBoundary) {
            break
        }

        toExclusive = fromInclusive
    }

    events.sort((a, b) => eventTimestampMs(a) - eventTimestampMs(b))

    return events
}

function eventTimestampMs(event: ParsedEvent): number {
    const timestamp = event.event.createdAtEpochMs
    if (typeof timestamp === 'bigint') {
        const numeric = Number(timestamp)
        if (!Number.isFinite(numeric)) {
            throw new Error('Event timestamp exceeds safe integer range')
        }
        return numeric
    }
    return timestamp ?? 0
}

function normalizeBatchSize(batchSize?: number): bigint {
    if (batchSize === undefined) {
        return DEFAULT_BATCH_SIZE
    }
    if (!Number.isFinite(batchSize) || batchSize <= 0) {
        throw new Error('batchSize must be a positive number')
    }
    return BigInt(Math.floor(batchSize))
}
