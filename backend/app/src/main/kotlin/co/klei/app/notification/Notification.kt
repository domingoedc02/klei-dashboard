package co.klei.app.notification

import co.klei.core.notification.NotificationType
import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import java.time.Instant
import java.util.UUID

/** One line in one User's bell. [target] is a route inside the app (`inquiries/{id}`, `upload`, `settings`), never a URL. */
@Entity
@Table(name = "notification")
@EncryptedEntity("notification")
class Notification(
    @Id val id: UUID,
    @Column(name = "user_id") val userId: UUID,
    type: NotificationType,
    title: String,
    target: String?,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Transient @Encrypted("type") var type: NotificationType = type
    @Transient @Encrypted("title") var title: String = title
    @Transient @Encrypted("target") var target: String? = target
    @Transient @Encrypted("read") var read: Boolean = false
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt

    internal var typeCt: ByteArray? = null
    internal var titleCt: ByteArray? = null
    internal var targetCt: ByteArray? = null
    internal var readCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null

    /** Plaintext ordering key (OQ-2), assigned by the database and only ever read. */
    @Column(name = "seq", insertable = false, updatable = false) internal var seq: Long? = null
}
