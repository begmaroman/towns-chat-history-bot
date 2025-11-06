import { fromBinary, fromJsonString } from '@bufbuild/protobuf'
import { bin_toString } from '@towns-protocol/utils'
import type { ChannelMessage } from '@towns-protocol/proto'
import { ChannelMessageSchema } from '@towns-protocol/proto'

export function parseChannelMessage(cleartext: string | Uint8Array): ChannelMessage | undefined {
    try {
        if (typeof cleartext === 'string') {
            return fromJsonString(ChannelMessageSchema, cleartext)
        }
        return fromBinary(ChannelMessageSchema, cleartext)
    } catch (error) {
        console.warn('Failed to parse channel message cleartext', error)
        return undefined
    }
}

export function formatCleartext(cleartext: string | Uint8Array, parsed?: ChannelMessage): string {
    if (parsed?.payload.case === 'post' && parsed.payload.value.content.case === 'text') {
        return parsed.payload.value.content.value.body
    }
    return typeof cleartext === 'string' ? cleartext : bin_toString(cleartext)
}
