package co.klei.app.identity

import co.klei.core.identity.Permission
import co.klei.core.identity.UserStatus
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndexed
import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import org.hibernate.annotations.OptimisticLock
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "role")
@EncryptedEntity("role")
class Role(@Id val id: UUID, name: String) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("name") var name: String = name

    internal var nameCt: ByteArray? = null
}

@Entity
@Table(name = "role_permission")
@EncryptedEntity("role_permission")
class RolePermission(@Id val id: UUID, @Column(name = "role_id") val roleId: UUID, permission: Permission) : EncryptedEntityBase() {
    @Transient @Encrypted("permission") var permission: Permission = permission

    internal var permissionCt: ByteArray? = null
}

@Entity
@Table(name = "app_user")
@EncryptedEntity("app_user")
class AppUser(
    @Id val id: UUID,
    name: String,
    email: String,
    password: String,
    @Column(name = "role_id") var roleId: UUID,
    status: UserStatus,
    verified: Boolean,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("name") var name: String = name
    @Transient @Encrypted("email") var email: String = email
    /** The Argon2id PHC string. */
    @Transient @Encrypted("password") var password: String = password
    @Transient @Encrypted("status") var status: UserStatus = status
    @Transient @Encrypted("verified") var verified: Boolean = verified
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt
    @Transient @Encrypted("last_active") var lastActive: Instant? = null

    /** The User's own 256 px JPEG (Story 6.1); the staff list only reports whether it is set. Outside the version, so a new photo does not stale the name the profile screen holds. */
    @field:OptimisticLock(excluded = true) @Column(name = "avatar_object_id") var avatarObjectId: UUID? = null

    /** The User's preferences (Story 6.3), one structured value. Outside the version, so saving preferences and renaming never stale each other; `Prefs.rev` is the version the API shows. */
    @Transient @Encrypted("prefs") var prefs: Prefs? = null

    internal var nameCt: ByteArray? = null
    internal var emailCt: ByteArray? = null
    @BlindIndexed(BidxDomain.APP_USER_EMAIL, "email") internal var emailBidx: ByteArray? = null
    internal var passwordCt: ByteArray? = null
    internal var statusCt: ByteArray? = null
    internal var verifiedCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
    /** Excluded from the version: a background touch must not turn an Admin's edit into a 409. */
    @field:OptimisticLock(excluded = true) internal var lastActiveCt: ByteArray? = null
    @field:OptimisticLock(excluded = true) internal var prefsCt: ByteArray? = null
}

/** Append-only (FR-40): a trigger rejects UPDATE and DELETE. `seq` is filled by the database. */
@Entity
@Table(name = "audit_entry")
@EncryptedEntity("audit_entry")
class AuditEntry(
    @Id val id: UUID,
    ts: Instant,
    actorId: String?,
    actorName: String,
    action: String,
    detail: String?,
    ip: String?,
) : EncryptedEntityBase() {
    @Transient @Encrypted("ts") var ts: Instant = ts
    @Transient @Encrypted("actor_id") var actorId: String? = actorId
    @Transient @Encrypted("actor_name") var actorName: String = actorName
    @Transient @Encrypted("action") var action: String = action
    @Transient @Encrypted("detail") var detail: String? = detail
    @Transient @Encrypted("ip") var ip: String? = ip

    internal var tsCt: ByteArray? = null
    internal var actorIdCt: ByteArray? = null
    internal var actorNameCt: ByteArray? = null
    internal var actionCt: ByteArray? = null
    internal var detailCt: ByteArray? = null
    internal var ipCt: ByteArray? = null

    /** Plaintext ordering key (OQ-2), assigned by the database and only ever read. */
    @Column(name = "seq", insertable = false, updatable = false) internal var seq: Long? = null
}

/** One refresh token of a sign-in family. Found by `token_bidx`; expiry and spent time are decrypted in memory. */
@Entity
@Table(name = "refresh_token")
@EncryptedEntity("refresh_token")
class RefreshToken(
    @Id val id: UUID,
    @Column(name = "user_id") val userId: UUID,
    @Column(name = "family_id") val familyId: UUID,
    token: String,
    expiresAt: Instant,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("token") var token: String = token
    @Transient @Encrypted("expires_at") var expiresAt: Instant = expiresAt
    @Transient @Encrypted("spent_at") var spentAt: Instant? = null

    @Column(name = "successor_id") var successorId: UUID? = null

    internal var tokenCt: ByteArray? = null
    @BlindIndexed(BidxDomain.REFRESH, "token") internal var tokenBidx: ByteArray? = null
    internal var expiresAtCt: ByteArray? = null
    internal var spentAtCt: ByteArray? = null
}

enum class CredentialKind { INVITE, VERIFY, RESET }

/** A one-time invite, verification or reset credential. Found by `secret_bidx`; consumed by deleting the row. */
@Entity
@Table(name = "auth_credential")
@EncryptedEntity("auth_credential")
class AuthCredential(
    @Id val id: UUID,
    @Column(name = "user_id") val userId: UUID,
    kind: CredentialKind,
    secret: String,
    expiresAt: Instant,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("kind") var kind: CredentialKind = kind
    @Transient @Encrypted("secret") var secret: String = secret
    /** Hex HMAC of the 6-digit code; the code itself is never stored. */
    @Transient @Encrypted("code") var code: String? = null
    @Transient @Encrypted("expires_at") var expiresAt: Instant = expiresAt
    @Transient @Encrypted("attempts") var attempts: Int = 0

    @Column(name = "invited_by_id") var invitedBy: UUID? = null
    @Column(name = "role_id") var roleId: UUID? = null

    internal var kindCt: ByteArray? = null
    internal var secretCt: ByteArray? = null
    @BlindIndexed(BidxDomain.CREDENTIAL, "secret") internal var secretBidx: ByteArray? = null
    internal var codeCt: ByteArray? = null
    internal var expiresAtCt: ByteArray? = null
    internal var attemptsCt: ByteArray? = null
}
