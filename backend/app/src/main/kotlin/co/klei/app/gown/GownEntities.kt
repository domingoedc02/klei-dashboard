package co.klei.app.gown

import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import java.time.Instant
import java.util.UUID

/** A saved Gown (FR-12). [dayBidx] is the creation day's blind index; [saveBidx] ties it to the batch it came from. */
@Entity
@Table(name = "gown")
@EncryptedEntity("gown")
class Gown(
    @Id val id: UUID,
    name: String,
    description: String?,
    confidence: Int,
    createdAt: Instant,
    isNew: Boolean,
    @Column(name = "created_by_id") val createdById: UUID?,
    @Column(name = "day_bidx") val dayBidx: ByteArray,
    @Column(name = "save_bidx") val saveBidx: ByteArray,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("name") var name: String = name
    @Transient @Encrypted("description") var description: String? = description
    @Transient @Encrypted("confidence") var confidence: Int = confidence
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt
    @Transient @Encrypted("is_new") var isNew: Boolean = isNew

    internal var nameCt: ByteArray? = null
    internal var descriptionCt: ByteArray? = null
    internal var confidenceCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
    internal var isNewCt: ByteArray? = null

    /** Plaintext ordering key (OQ-2), assigned by the database and only ever read. */
    @Column(name = "seq", insertable = false, updatable = false) internal var seq: Long? = null
}

/** One tag of a Gown, by Taxonomy id. Ids only, so nothing here is a business value. */
@Entity
@Table(name = "gown_attribute")
class GownAttribute(
    @Id val id: UUID,
    @Column(name = "gown_id") val gownId: UUID,
    @Column(name = "taxonomy_value_id") val taxonomyValueId: UUID,
)

/** One search word of a Gown, as an HMAC (architecture §4.2). */
@Entity
@Table(name = "gown_term")
class GownTerm(
    @Id val id: UUID,
    @Column(name = "gown_id") val gownId: UUID,
    @Column(name = "term_bidx") val termBidx: ByteArray,
)
