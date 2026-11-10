package co.klei.app.auth

import co.klei.core.audit.AuditAction
import co.klei.app.identity.AppUser
import co.klei.app.identity.AuditService
import co.klei.app.identity.AuthCredential
import co.klei.app.identity.CredentialKind
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.identity.PasswordPolicy
import co.klei.core.identity.UserStatus
import co.klei.core.mail.MailPort
import co.klei.core.mail.MailTemplate
import co.klei.core.notification.NotificationPort
import co.klei.core.notification.NotificationType
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.PasswordHasher
import co.klei.crypto.SecureTokens
import jakarta.persistence.EntityManager
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.util.HexFormat
import java.util.UUID

/** What the invite page shows; the email and the inviter come from the server, never from the link. */
data class InviteView(val email: String, val inviter: String?, val role: String)

enum class VerifyResult { OK, WRONG, LOCKED }
enum class ResendResult { SENT, TOO_SOON }

/**
 * One-time credentials (architecture §6.3): found by blind index, consumed by deleting the row, expiry and attempts
 * decrypted in memory. Refusals are results, not exceptions, so a counted attempt still commits.
 */
@Service
class CredentialService(
    private val em: EntityManager,
    private val users: UserService,
    private val roles: RoleService,
    private val hasher: PasswordHasher,
    private val tokens: SecureTokens,
    private val bidx: BlindIndex,
    private val mail: MailPort,
    private val audit: AuditService,
    private val limiter: RateLimiter,
    private val refresh: RefreshService,
    private val notifier: NotificationPort,
    @Value("\${klei.auth-base-url}") base: String,
) {
    internal var clock: Clock = Clock.systemUTC()
    private val base = base.trimEnd('/')

    /** Made at boot: every reset request pays one Argon2id verify, known email or not, so timing does not tell them apart. */
    private val dummyHash = hasher.hash("klei-dummy-reset")

    /** 409 when the email is taken; the Invited User exists at once, so the staff list can show them. */
    @Transactional
    fun invite(name: String, email: String, roleId: UUID, by: UUID): AppUser {
        if (roles.roles().none { it.id == roleId }) throw ProblemException(ProblemCode.VALIDATION_FAILED)
        if (users.find(email) != null) throw ProblemException(ProblemCode.CONFLICT)
        val inviter = users.get(by) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        // The placeholder password is random and thrown away: an Invited User cannot sign in.
        val user = users.create(name, email, tokens.newToken(), roleId, UserStatus.INVITED, verified = false)
        issueInvite(user, by)
        audit.record(AuditAction.USER_INVITED, detail = user.name, actorId = by, actorName = inviter.name)
        return user
    }

    /** Resend, or the Invited User's email or Role changed: the open invitation is replaced and the old link stops working. */
    @Transactional
    fun reinvite(user: AppUser, by: UUID) {
        drop(user.id, CredentialKind.INVITE)
        issueInvite(user, by)
    }

    private fun issueInvite(user: AppUser, by: UUID) {
        val secret = tokens.newToken()
        em.persist(AuthCredential(UUID.randomUUID(), user.id, CredentialKind.INVITE, secret, clock.instant().plus(INVITE_TTL)).also {
            it.invitedBy = by
            it.roleId = user.roleId
        })
        mail.send(MailTemplate.INVITE, user.email, mapOf("link" to "$base/invite#$secret"))
    }

    /** Null for unknown, used or expired links; the page then shows the one expired message. */
    @Transactional(readOnly = true)
    fun peekInvite(secret: String): InviteView? {
        val c = live(secret, CredentialKind.INVITE) ?: return null
        val u = users.get(c.userId)?.takeIf { it.status == UserStatus.INVITED } ?: return null
        val inviter = c.invitedBy?.let { users.get(it) }?.name
        val role = roles.roles().firstOrNull { it.id == c.roleId }?.name ?: return null
        return InviteView(u.email, inviter, role)
    }

    /** The new User's id, or null when the link is spent. Callers validate the form first; a bad password here is a bug, so it is refused rather than stored. */
    @Transactional
    fun accept(secret: String, name: String, password: String): UUID? {
        require(PasswordPolicy.accepts(password) && name.isNotBlank()) { "validated by caller" }
        val c = live(secret, CredentialKind.INVITE) ?: return null
        val u = users.get(c.userId)?.takeIf { it.status == UserStatus.INVITED } ?: return null
        u.name = name.trim()
        u.password = hasher.hash(password)
        u.status = UserStatus.ACTIVE
        em.remove(c)
        issueVerify(u)
        // [ASSUMPTION] team activity goes to Admins only; the new User is not told about themselves.
        notifier.notify(NotificationType.TEAM_ACTIVITY, roles.adminIds().filter { it != u.id }, "${u.name} accepted the invite", "settings")
        return u.id
    }

    /** Replaces any earlier verification for this User; the old code and link stop working. */
    @Transactional
    fun issueVerify(u: AppUser) {
        drop(u.id, CredentialKind.VERIFY)
        val secret = tokens.newToken()
        val code = tokens.newCode()
        val c = AuthCredential(UUID.randomUUID(), u.id, CredentialKind.VERIFY, secret, clock.instant().plus(VERIFY_TTL))
        c.code = HexFormat.of().formatHex(tokens.codeMac(code))
        em.persist(c)
        mail.send(MailTemplate.VERIFY, u.email, mapOf("code" to code, "link" to "$base/verify#$secret"))
    }

    /** The 30 s gate is read off the stored expiry, so it needs no extra column. */
    @Transactional
    fun resend(userId: UUID): ResendResult {
        val u = pending(userId) ?: return ResendResult.TOO_SOON
        val old = current(userId, CredentialKind.VERIFY)
        if (old != null && old.expiresAt.isAfter(clock.instant().plus(VERIFY_TTL).minus(RESEND_WAIT))) return ResendResult.TOO_SOON
        issueVerify(u)
        return ResendResult.SENT
    }

    @Transactional
    fun verifyCode(userId: UUID, code: String, ip: String): VerifyResult {
        val u = pending(userId) ?: return VerifyResult.WRONG
        val key = "verify:$userId"
        if (limiter.retryAfter(key, ip) != null) return VerifyResult.LOCKED
        val c = current(userId, CredentialKind.VERIFY)
        if (c == null || !c.expiresAt.isAfter(clock.instant())) { c?.let(em::remove); return VerifyResult.WRONG }
        val stored = c.code?.let { HexFormat.of().parseHex(it) }
        val right = CODE.matches(code) && stored != null && tokens.equal(stored, tokens.codeMac(code))
        if (!right) {
            c.attempts += 1
            limiter.fail(key, ip)
            if (c.attempts >= MAX_ATTEMPTS) em.remove(c)
            return VerifyResult.WRONG
        }
        markVerified(u, c)
        limiter.clear(key)
        return VerifyResult.OK
    }

    /** The mailed link proves mailbox access on its own; the secret is 256 bits, so no attempt counter. */
    @Transactional
    fun verifyLink(secret: String): Boolean {
        val c = live(secret, CredentialKind.VERIFY) ?: return false
        val u = pending(c.userId) ?: return false
        markVerified(u, c)
        return true
    }

    @Transactional(readOnly = true)
    fun emailOf(userId: UUID): String? = pending(userId)?.email

    /**
     * Null when the request was taken (whether or not the email is known), else the time left on the throttle.
     * Only an Active User gets a link; an Invited one still has the invite. One reset credential per User: a new request replaces the old.
     * shortcut: the unknown-email path skips one insert, a few ms against the Argon2id verify; add a queue if that ever matters.
     */
    @Transactional
    fun requestReset(email: String, ip: String): Duration? {
        val key = "reset:" + HexFormat.of().formatHex(bidx.of(BidxDomain.APP_USER_EMAIL, email))
        limiter.retryAfter(key, ip)?.let { return it }
        limiter.fail(key, ip)
        hasher.verify("not-the-password", dummyHash)
        val u = users.find(email)?.takeIf { it.status == UserStatus.ACTIVE } ?: return null
        drop(u.id, CredentialKind.RESET)
        val secret = tokens.newToken()
        em.persist(AuthCredential(UUID.randomUUID(), u.id, CredentialKind.RESET, secret, clock.instant().plus(RESET_TTL)))
        mail.send(MailTemplate.RESET, u.email, mapOf("link" to "$base/reset#$secret"))
        return null
    }

    /** The email the new password is for, or null for unknown, used or expired links. */
    @Transactional(readOnly = true)
    fun peekReset(secret: String): String? {
        val c = live(secret, CredentialKind.RESET) ?: return null
        return users.get(c.userId)?.takeIf { it.status == UserStatus.ACTIVE }?.email
    }

    /** False when the link is spent. Callers validate the password first. Every sign-in of the User ends and the sign-in lockout is lifted. */
    @Transactional
    fun reset(secret: String, password: String, ip: String): Boolean {
        require(PasswordPolicy.accepts(password)) { "validated by caller" }
        val c = live(secret, CredentialKind.RESET) ?: return false
        val u = users.get(c.userId)?.takeIf { it.status == UserStatus.ACTIVE } ?: return false
        val (id, name, email) = Triple(u.id, u.name, u.email)
        u.password = hasher.hash(password)
        em.remove(c)
        em.flush()
        refresh.revokeAllFor(id)
        limiter.clear(HexFormat.of().formatHex(bidx.of(BidxDomain.APP_USER_EMAIL, email)))
        audit.record(AuditAction.PASSWORD_RESET, actorId = id, actorName = name, ip = ip)
        return true
    }

    private fun markVerified(u: AppUser, c: AuthCredential) {
        u.verified = true
        em.remove(c)
        audit.record(AuditAction.EMAIL_VERIFIED, actorId = u.id, actorName = u.name)
    }

    private fun pending(userId: UUID): AppUser? =
        users.get(userId)?.takeIf { it.status == UserStatus.ACTIVE && !it.verified }

    private fun live(secret: String, kind: CredentialKind): AuthCredential? {
        if (secret.length != TOKEN_LENGTH) return null
        val c = em.createQuery("select c from AuthCredential c where c.secretBidx = :b", AuthCredential::class.java)
            .setParameter("b", bidx.of(BidxDomain.CREDENTIAL, secret)).resultList.firstOrNull() ?: return null
        return c.takeIf { it.kind == kind && it.expiresAt.isAfter(clock.instant()) }
    }

    // kind is encrypted, so the User's few credentials are filtered in memory.
    private fun current(userId: UUID, kind: CredentialKind): AuthCredential? =
        em.createQuery("select c from AuthCredential c where c.userId = :u", AuthCredential::class.java)
            .setParameter("u", userId).resultList.firstOrNull { it.kind == kind }

    private fun drop(userId: UUID, kind: CredentialKind) {
        em.createQuery("select c from AuthCredential c where c.userId = :u", AuthCredential::class.java)
            .setParameter("u", userId).resultList.filter { it.kind == kind }.forEach(em::remove)
    }

    companion object {
        val INVITE_TTL: Duration = Duration.ofDays(7)
        val VERIFY_TTL: Duration = Duration.ofMinutes(30)
        val RESET_TTL: Duration = Duration.ofMinutes(30)
        val RESEND_WAIT: Duration = Duration.ofSeconds(30)
        const val MAX_ATTEMPTS = 5
        const val TOKEN_LENGTH = 43
        private val CODE = Regex("\\d{6}")
    }
}
