package co.klei.crypto

import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Encrypts and decrypts one column value. The AAD binds the blob to its key, table, column and row. */
class CryptoService internal constructor(private val deks: Deks) {
    private data class KeyId(val dek: UUID, val col: ColumnRef)

    private val columnKeys = ConcurrentHashMap<KeyId, ByteArray>()

    private fun columnKey(dek: Dek, col: ColumnRef) =
        columnKeys.computeIfAbsent(KeyId(dek.id, col)) { Jca.hkdf(dek.key, "col|${col.table}|${col.column}") }

    fun encrypt(plain: ByteArray, col: ColumnRef, rowId: UUID): ByteArray {
        val dek = deks.active()
        val frame = ByteArray(Envelope.paddedSize(4 + plain.size))
        ByteBuffer.wrap(frame).putInt(plain.size).put(plain)
        val nonce = Jca.random(12)
        val sealed = Jca.seal(columnKey(dek, col), nonce, Envelope.aad(dek.id, col, rowId), frame)
        return ByteBuffer.allocate(Envelope.HEADER + sealed.size)
            .put(Envelope.VERSION).putLong(dek.id.mostSignificantBits).putLong(dek.id.leastSignificantBits).put(nonce).put(sealed).array()
    }

    fun decrypt(blob: ByteArray, col: ColumnRef, rowId: UUID): ByteArray {
        if (blob.size < Envelope.HEADER + Envelope.TAG + 32 || blob[0] != Envelope.VERSION) throw CryptoException("bad_envelope")
        val buf = ByteBuffer.wrap(blob).position(1)
        val dek = deks.byId(UUID(buf.getLong(), buf.getLong()))
        val nonce = ByteArray(12).also(buf::get)
        val sealed = ByteArray(buf.remaining()).also(buf::get)
        val frame = Jca.open(columnKey(dek, col), nonce, Envelope.aad(dek.id, col, rowId), sealed)
        val len = ByteBuffer.wrap(frame).getInt()
        if (len < 0 || len > frame.size - 4) throw CryptoException("bad_frame")
        return frame.copyOfRange(4, 4 + len)
    }
}
