package co.klei.app.auth

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

enum class TotpState { PENDING, ACTIVE, RESET }

/** A User's authenticator secret (ADR-19). [lastUsedStep] is the newest time step accepted, which stops a code being used twice. */
@Entity
@Table(name = "user_totp")
@EncryptedEntity("user_totp")
class UserTotp(@Id val id: UUID, @Column(name = "user_id") val userId: UUID, secret: String, state: TotpState) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("secret") var secret: String = secret
    @Transient @Encrypted("state") var state: TotpState = state
    @Transient @Encrypted("last_used_step") var lastUsedStep: Long = 0

    internal var secretCt: ByteArray? = null
    internal var stateCt: ByteArray? = null
    internal var lastUsedStepCt: ByteArray? = null
}

/** One recovery code, kept only as an Argon2id hash. */
@Entity
@Table(name = "recovery_code")
@EncryptedEntity("recovery_code")
class RecoveryCode(@Id val id: UUID, @Column(name = "user_id") val userId: UUID, hash: String) : EncryptedEntityBase() {
    @Transient @Encrypted("hash") var hash: String = hash
    @Transient @Encrypted("used_at") var usedAt: Instant? = null

    internal var hashCt: ByteArray? = null
    internal var usedAtCt: ByteArray? = null
}
