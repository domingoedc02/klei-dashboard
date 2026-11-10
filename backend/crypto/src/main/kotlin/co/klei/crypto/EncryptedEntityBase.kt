package co.klei.crypto

import jakarta.persistence.MappedSuperclass
import jakarta.persistence.Transient

/** Base of every entity with `@Encrypted` fields. Holds the canonical plaintext last loaded or written, per field. */
@MappedSuperclass
abstract class EncryptedEntityBase {
    @Transient
    internal var snapshot: MutableMap<String, ByteArray?> = HashMap()
}
