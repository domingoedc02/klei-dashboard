package co.klei.core.storage

import java.time.Instant
import java.util.UUID

/** One object as the bucket lists it. Keys are random UUIDs; the listing never shows a name, type or metadata. */
class ListedObject(val key: String, val lastModified: Instant)

interface ObjectStorePort {
    /** Creates the bucket when it does not exist. Safe to call twice. */
    fun ensureBucket()

    /** True when the bucket answers. Never throws. */
    fun isReachable(): Boolean

    /** Stores [body] under [key] as `application/octet-stream` with no user metadata. */
    fun put(key: UUID, body: ByteArray)

    /** The stored bytes, or null when the key does not exist. */
    fun get(key: UUID): ByteArray?

    /** Removes the object. A missing key is not an error. */
    fun delete(key: UUID)

    /** Every object in the bucket. shortcut: one full listing per sweep, fine to ~100k objects; page it when the sweep gets slow. */
    fun list(): List<ListedObject>
}
