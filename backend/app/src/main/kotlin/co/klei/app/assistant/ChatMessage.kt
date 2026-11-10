package co.klei.app.assistant

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

/** `user` is what the person typed, `assistant` what the provider answered. Declaration order is the tie-break for equal times. */
enum class ChatRole { USER, ASSISTANT }

/** One line of one User's assistant chat. [gowns] holds the comma-separated ids of Gowns the answer suggested (checked before storing). */
@Entity
@Table(name = "chat_message")
@EncryptedEntity("chat_message")
class ChatMessage(
    @Id val id: UUID,
    @Column(name = "user_id") val userId: UUID,
    role: ChatRole,
    text: String,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Transient @Encrypted("role") var role: ChatRole = role
    @Transient @Encrypted("text") var text: String = text
    @Transient @Encrypted("gowns") var gowns: String? = null
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt

    internal var roleCt: ByteArray? = null
    internal var textCt: ByteArray? = null
    internal var gownsCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
}
