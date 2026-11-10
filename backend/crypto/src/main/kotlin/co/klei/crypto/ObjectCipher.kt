package co.klei.crypto

import java.nio.ByteBuffer
import java.util.UUID

/** One encrypted object: [body] goes to S3, [wrappedDek] and [kekVersion] go to its `stored_object` row. */
class SealedObject(val body: ByteArray, val wrappedDek: ByteArray, val kekVersion: Int)

/**
 * Object encryption (architecture §5.5): fresh DEK per object, body `[version:1][nonce:12][ciphertext + tag]`,
 * plaintext framed `[len:4][data][zero pad]` to 64 KB steps, AAD `obj|<bucket>|<objectId>`.
 */
class ObjectCipher internal constructor(private val ring: KeyRing) {
    fun encrypt(plain: ByteArray, bucket: String, objectId: UUID): SealedObject {
        val dek = Jca.random(32)
        val frame = ByteArray(maxOf(1, (4 + plain.size + STEP - 1) / STEP) * STEP)
        ByteBuffer.wrap(frame).putInt(plain.size).put(plain)
        val nonce = Jca.random(12)
        val sealed = Jca.seal(dek, nonce, aad(bucket, objectId), frame)
        val body = ByteBuffer.allocate(1 + 12 + sealed.size).put(Envelope.VERSION).put(nonce).put(sealed).array()
        return SealedObject(body, Wrap.wrap(ring.keks.getValue(ring.activeKek), dek, objectId.toString()), ring.activeKek)
    }

    fun decrypt(obj: SealedObject, bucket: String, objectId: UUID): ByteArray {
        val kek = ring.keks[obj.kekVersion] ?: throw CryptoException("missing_kek")
        if (obj.body.size < 1 + 12 + 16 + STEP || obj.body[0] != Envelope.VERSION) throw CryptoException("bad_envelope")
        val dek = Wrap.unwrap(kek, obj.wrappedDek, objectId.toString())
        val frame = Jca.open(dek, obj.body.copyOfRange(1, 13), aad(bucket, objectId), obj.body.copyOfRange(13, obj.body.size))
        val len = ByteBuffer.wrap(frame).getInt()
        if (len < 0 || len > frame.size - 4) throw CryptoException("bad_frame")
        return frame.copyOfRange(4, 4 + len)
    }

    private fun aad(bucket: String, objectId: UUID) = "obj|$bucket|$objectId".toByteArray(Charsets.UTF_8)

    private companion object { const val STEP = 64 * 1024 }
}
