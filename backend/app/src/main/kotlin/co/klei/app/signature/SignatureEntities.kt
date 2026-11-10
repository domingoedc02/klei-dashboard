package co.klei.app.signature

import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import java.util.UUID

/** A User's reply signature (FR-31). Plain text lines only; HTML comes with the reply screen (Story 7.3). */
@Entity
@Table(name = "signature")
@EncryptedEntity("signature")
class Signature(
    @Id @Column(name = "user_id") val userId: UUID,
    enabled: Boolean,
    signoff: String,
    name: String,
    title: String,
    phone: String,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("enabled") var enabled: Boolean = enabled
    @Transient @Encrypted("signoff") var signoff: String = signoff
    @Transient @Encrypted("name") var name: String = name
    @Transient @Encrypted("title") var title: String = title
    @Transient @Encrypted("phone") var phone: String = phone

    internal var enabledCt: ByteArray? = null
    internal var signoffCt: ByteArray? = null
    internal var nameCt: ByteArray? = null
    internal var titleCt: ByteArray? = null
    internal var phoneCt: ByteArray? = null
}

/** The Studio's name and address, set by an Admin; the closing lines of every signature. One row, fixed id. */
@Entity
@Table(name = "workspace")
@EncryptedEntity("workspace")
class Workspace(
    @Id val id: UUID,
    studioName: String,
    studioAddress: String,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("studio_name") var studioName: String = studioName
    /** Up to four lines separated by a line feed. */
    @Transient @Encrypted("studio_address") var studioAddress: String = studioAddress

    internal var studioNameCt: ByteArray? = null
    internal var studioAddressCt: ByteArray? = null
}
