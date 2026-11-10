package co.klei.app.upload

import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.storage.ObjectStorePort
import co.klei.crypto.ObjectCipher
import co.klei.crypto.SealedObject
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import java.util.UUID

/** What a `stored_object` row needs after [ObjectVault.put]. */
class StoredKey(val id: UUID, val wrappedDek: ByteArray, val kekVersion: Int)

/** Encrypt-then-store and fetch-then-decrypt for S3 objects (AD-7). Callers never see an unencrypted body in the bucket. */
@Component
class ObjectVault(
    private val cipher: ObjectCipher,
    private val store: ObjectStorePort,
    @Value("\${klei.s3.bucket}") private val bucket: String,
) {
    private val log = LoggerFactory.getLogger(ObjectVault::class.java)

    /** Seals [plain] under a fresh DEK and a random UUID key, then writes it. The row for it is the caller's to insert. */
    fun put(plain: ByteArray): StoredKey {
        val id = UUID.randomUUID()
        val sealed = cipher.encrypt(plain, bucket, id)
        store.put(id, sealed.body)
        return StoredKey(id, sealed.wrappedDek, sealed.kekVersion)
    }

    /** A tampered or swapped body throws `CryptoException`, which the problem advice answers as 500 `crypto_failure`. */
    fun read(o: StoredObject): ByteArray {
        val body = store.get(o.id)
        if (body == null) {
            log.error("object missing for a stored_object row")
            throw ProblemException(ProblemCode.INTERNAL)
        }
        return cipher.decrypt(SealedObject(body, o.wrappedDek, o.kekVersion), bucket, o.id)
    }

    /** Best effort: a failure here is the sweep's job. */
    fun deleteQuietly(ids: List<UUID>) {
        for (id in ids) runCatching { store.delete(id) }.onFailure { log.warn("object delete failed, left for the sweep: {}", it.javaClass.name) }
    }
}
