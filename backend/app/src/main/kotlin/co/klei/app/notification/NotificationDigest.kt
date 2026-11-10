package co.klei.app.notification

import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import java.time.Instant
import java.util.UUID

/** When one User was last mailed a digest; the row id is the User id. The job locks it, so two instances never mail the same digest. */
@Entity
@Table(name = "notification_digest")
@EncryptedEntity("notification_digest")
class NotificationDigest(@Id val id: UUID, lastDigestAt: Instant) : EncryptedEntityBase() {
    @Transient @Encrypted("last_digest_at") var lastDigestAt: Instant = lastDigestAt

    internal var lastDigestAtCt: ByteArray? = null
}
