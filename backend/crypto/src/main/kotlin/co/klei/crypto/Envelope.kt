package co.klei.crypto

import java.util.UUID

/**
 * Column blob layout (architecture §5.2):
 * `[version:1][dek_id:16][nonce:12][ciphertext + tag:16]`, plain frame `[len:4][data][zero pad]`.
 */
object Envelope {
    internal const val VERSION: Byte = 1
    internal const val HEADER = 1 + 16 + 12
    internal const val TAG = 16

    /** Frame size: 32-byte steps up to 256 bytes, then the next power of two. */
    internal fun paddedSize(frameLen: Int): Int = when {
        frameLen <= 256 -> maxOf(32, (frameLen + 31) / 32 * 32)
        else -> Integer.highestOneBit(frameLen - 1) shl 1
    }

    /** True when [blob] has the shape of a padded envelope. Used by the schema and leak tests; decrypts nothing. */
    fun looksValid(blob: ByteArray): Boolean {
        if (blob.size < HEADER + TAG + 32 || blob[0] != VERSION) return false
        val frame = blob.size - HEADER - TAG
        return frame == paddedSize(frame)
    }

    internal fun aad(dekId: UUID, col: ColumnRef, rowId: UUID): ByteArray =
        "$VERSION|$dekId|${col.table}|${col.column}|$rowId".toByteArray(Charsets.UTF_8)
}
