package co.klei.app.probe

import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndexed
import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

@Serializable
data class Attrs(val v: Int, val tags: List<String>)

enum class Phase { NEW, IN_PROGRESS }

/** Test-only entity: one field of every supported kind, to prove the listener round trip. */
@Entity
@Table(name = "crypto_probe")
@EncryptedEntity("crypto_probe")
class CryptoProbe(
    @Id val id: UUID,
    name: String,
    email: String?,
    seenAt: Instant?,
    flag: Boolean,
    phase: Phase,
    attrs: Attrs?,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("name") var name: String = name
    @Transient @Encrypted("email") var email: String? = email
    @Transient @Encrypted("seen_at") var seenAt: Instant? = seenAt
    @Transient @Encrypted("flag") var flag: Boolean = flag
    @Transient @Encrypted("phase") var phase: Phase = phase
    @Transient @Encrypted("attrs") var attrs: Attrs? = attrs

    internal var nameCt: ByteArray? = null
    internal var emailCt: ByteArray? = null
    @BlindIndexed(BidxDomain.CLIENT_EMAIL, "email") internal var emailBidx: ByteArray? = null
    internal var seenAtCt: ByteArray? = null
    internal var flagCt: ByteArray? = null
    internal var phaseCt: ByteArray? = null
    internal var attrsCt: ByteArray? = null
}

@Entity
@Table(name = "crypto_probe_2")
@EncryptedEntity("crypto_probe_2")
class CryptoProbe2(@Id val id: UUID, name: String) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("name") var name: String = name

    internal var nameCt: ByteArray? = null
}
