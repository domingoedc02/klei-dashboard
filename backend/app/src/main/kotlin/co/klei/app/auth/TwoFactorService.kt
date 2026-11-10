package co.klei.app.auth

import co.klei.app.identity.AppUser
import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.PasswordHasher
import co.klei.crypto.Totp
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.net.URLEncoder
import java.time.Clock
import java.util.HexFormat
import java.util.UUID

data class TwoFactorStatus(val enabled: Boolean, val recoveryLeft: Int, val reset: Boolean)

/** Returned once by `start`: the secret is never readable again. */
data class TwoFactorSetup(val uri: String, val secret: String, val qr: String)

/**
 * FR-44 / ADR-19. Wrong codes count on the same [RateLimiter] account key as wrong passwords. A code (time step) is
 * accepted once; a recovery code once. Every method that changes a row locks it, so two requests cannot both spend one code.
 * shortcut: no Audit Entry for "new recovery codes" (not in the catalogue); add `TWOFA_CODES_RENEWED` if the studio wants it.
 */
@Service
class TwoFactorService(
    private val em: EntityManager,
    private val users: UserService,
    private val hasher: PasswordHasher,
    private val limiter: RateLimiter,
    private val bidx: BlindIndex,
    private val audit: AuditService,
) {
    internal var clock: Clock = Clock.systemUTC()
    private val dummy by lazy { hasher.hash("klei-dummy-recovery") }

    @Transactional(readOnly = true)
    fun status(userId: UUID): TwoFactorStatus {
        val t = row(userId)
        val on = t?.state == TotpState.ACTIVE
        return TwoFactorStatus(on, if (on) codes(userId).count { it.usedAt == null } else 0, t?.state == TotpState.RESET)
    }

    @Transactional(readOnly = true)
    fun required(userId: UUID): Boolean = row(userId)?.state == TotpState.ACTIVE

    /** For the Staff list: which Users have it on. The state is an envelope, so this reads the (few) rows and filters here. */
    @Transactional(readOnly = true)
    fun activeIds(): Set<UUID> =
        em.createQuery("select t from UserTotp t", UserTotp::class.java).resultList.filter { it.state == TotpState.ACTIVE }.map { it.userId }.toSet()

    /** Replaces a pending (or Admin-reset) secret; an active one must be turned off first. */
    @Transactional(noRollbackFor = [ProblemException::class])
    fun start(userId: UUID, ip: String): TwoFactorSetup {
        val u = user(userId)
        guard(u, ip)
        val t = row(userId, lock = true)
        if (t?.state == TotpState.ACTIVE) throw ProblemException(ProblemCode.CONFLICT)
        val secret = Totp.newSecret()
        if (t == null) em.persist(UserTotp(UUID.randomUUID(), userId, secret, TotpState.PENDING))
        else { t.secret = secret; t.state = TotpState.PENDING; t.lastUsedStep = 0 }
        val uri = "otpauth://totp/${enc(ISSUER)}:${enc(u.email)}?secret=$secret&issuer=${enc(ISSUER)}&algorithm=SHA1&digits=6&period=30"
        return TwoFactorSetup(uri, secret, Qr.svgDataUri(uri))
    }

    /** The recovery codes, in plain text, this once. */
    @Transactional(noRollbackFor = [ProblemException::class])
    fun confirm(userId: UUID, code: String?, ip: String): List<String> {
        val u = user(userId)
        guard(u, ip)
        val t = row(userId, lock = true)?.takeIf { it.state == TotpState.PENDING } ?: throw ProblemException(ProblemCode.CONFLICT)
        val step = Totp.match(t.secret, code.orEmpty().trim(), clock.instant().epochSecond, t.lastUsedStep)
        if (step == null) { fail(u, ip); throw wrong("code") }
        t.state = TotpState.ACTIVE
        t.lastUsedStep = step
        val plain = replaceCodes(userId)
        audit.record(AuditAction.TWOFA_ENABLED, actorId = userId, actorName = u.name, ip = ip)
        return plain
    }

    @Transactional(noRollbackFor = [ProblemException::class])
    fun disable(userId: UUID, password: String?, code: String?, ip: String) {
        val u = user(userId)
        val t = proof(u, password, code, ip)
        em.createQuery("delete from RecoveryCode c where c.userId = :u").setParameter("u", userId).executeUpdate()
        em.remove(t)
        audit.record(AuditAction.TWOFA_DISABLED, actorId = userId, actorName = u.name, ip = ip)
    }

    @Transactional(noRollbackFor = [ProblemException::class])
    fun newCodes(userId: UUID, password: String?, code: String?, ip: String): List<String> {
        val u = user(userId)
        proof(u, password, code, ip)
        return replaceCodes(userId)
    }

    /** Second step of Auth Web sign-in. False for a wrong, reused or expired code; the failure is counted and audited without the code. */
    @Transactional
    fun signIn(user: AppUser, input: String, ip: String): Boolean {
        val t = row(user.id, lock = true)?.takeIf { it.state == TotpState.ACTIVE } ?: return false
        if (consume(t, input)) { limiter.clear(key(user)); return true }
        fail(user, ip)
        audit.record(AuditAction.SIGN_IN_TWOFA_FAILED, actorId = user.id, actorName = user.name, ip = ip)
        return false
    }

    /** Admin reset (the caller audits). The secret and the codes are gone; Profile shows a banner until the User sets it up again. */
    @Transactional
    fun reset(userId: UUID) {
        val t = row(userId, lock = true)?.takeIf { it.state == TotpState.ACTIVE } ?: throw ProblemException(ProblemCode.CONFLICT)
        em.createQuery("delete from RecoveryCode c where c.userId = :u").setParameter("u", userId).executeUpdate()
        t.secret = ""
        t.state = TotpState.RESET
        t.lastUsedStep = 0
    }

    private fun proof(u: AppUser, password: String?, code: String?, ip: String): UserTotp {
        guard(u, ip)
        val t = row(u.id, lock = true)?.takeIf { it.state == TotpState.ACTIVE } ?: throw ProblemException(ProblemCode.CONFLICT)
        if (!hasher.verify(password.orEmpty(), u.password)) { fail(u, ip); throw wrong("password") }
        if (!consume(t, code.orEmpty())) { fail(u, ip); throw wrong("code") }
        limiter.clear(key(u))
        return t
    }

    /** A live TOTP code newer than the last one used, or an unused recovery code; marks it spent. A miss costs about one password check. */
    private fun consume(t: UserTotp, input: String): Boolean {
        Totp.match(t.secret, input.trim(), clock.instant().epochSecond, t.lastUsedStep)?.let { t.lastUsedStep = it; return true }
        val norm = input.filter { it.isLetterOrDigit() }.uppercase()
        if (norm.length != RECOVERY_LENGTH) { hasher.verify(norm, dummy); return false }
        val hit = codes(t.userId).firstOrNull { it.usedAt == null && hasher.verify(norm, it.hash) } ?: return false
        hit.usedAt = clock.instant()
        return true
    }

    private fun replaceCodes(userId: UUID): List<String> {
        em.createQuery("delete from RecoveryCode c where c.userId = :u").setParameter("u", userId).executeUpdate()
        return List(RECOVERY_COUNT) { Totp.newRecoveryCode() }.onEach { em.persist(RecoveryCode(UUID.randomUUID(), userId, hasher.hash(it))) }
            .map { "${it.take(5)}-${it.drop(5)}" }
    }

    private fun guard(u: AppUser, ip: String) {
        if (limiter.retryAfter(key(u), ip) != null) throw ProblemException(ProblemCode.RATE_LIMITED)
    }

    private fun fail(u: AppUser, ip: String) {
        if (limiter.fail(key(u), ip)) audit.record(AuditAction.SIGN_IN_LOCKED, actorId = u.id, actorName = u.name, ip = ip)
    }

    private fun wrong(field: String) = ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem(field, "incorrect")))

    private fun key(u: AppUser) = HexFormat.of().formatHex(bidx.of(BidxDomain.APP_USER_EMAIL, u.email))

    private fun user(id: UUID) = users.get(id) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)

    private fun row(userId: UUID, lock: Boolean = false): UserTotp? =
        em.createQuery("select t from UserTotp t where t.userId = :u", UserTotp::class.java).setParameter("u", userId)
            .apply { if (lock) lockMode = LockModeType.PESSIMISTIC_WRITE }.resultList.firstOrNull()

    private fun codes(userId: UUID): List<RecoveryCode> =
        em.createQuery("select c from RecoveryCode c where c.userId = :u", RecoveryCode::class.java).setParameter("u", userId).resultList

    private fun enc(s: String) = URLEncoder.encode(s, Charsets.UTF_8).replace("+", "%20")

    companion object {
        const val ISSUER = "Klei Bridal"
        const val RECOVERY_COUNT = 8
        const val RECOVERY_LENGTH = 10
    }
}
