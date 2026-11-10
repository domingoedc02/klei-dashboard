package co.klei.app.taxonomy

import co.klei.core.taxonomy.TaxonomyType
import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import java.util.UUID

/** One allowed tag value (FR-38). A rename keeps the id, so Gowns that point at it follow. */
@Entity
@Table(name = "taxonomy_value")
@EncryptedEntity("taxonomy_value")
class TaxonomyValue(@Id val id: UUID, type: TaxonomyType, value: String) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("type") var type: TaxonomyType = type
    @Transient @Encrypted("value") var value: String = value

    internal var typeCt: ByteArray? = null
    internal var valueCt: ByteArray? = null
}
