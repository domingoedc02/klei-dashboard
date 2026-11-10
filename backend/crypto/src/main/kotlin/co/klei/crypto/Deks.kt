package co.klei.crypto

import java.util.UUID

internal class Dek(val id: UUID, val key: ByteArray)

/** Source of tenant data keys. [DekStore] is the database-backed one; tests use an in-memory one. */
internal interface Deks {
    /** The key that encrypts new data. */
    fun active(): Dek

    /** Any key by id. Unknown id: [CryptoException] `unknown_dek`. */
    fun byId(id: UUID): Dek
}
