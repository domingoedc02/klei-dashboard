package co.klei.app.auth

import co.klei.core.audit.AuditAction
import co.klei.app.identity.AuditService
import co.klei.app.identity.RefreshToken
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.security.PermissionEpoch
import co.klei.app.security.SessionRegistry
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.identity.UserStatus
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.SecureTokens
import co.klei.crypto.TokenClaims
import co.klei.crypto.TokenSigner
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

data class TokenPair(val accessToken: String, val refreshToken: String, val expiresIn: Long)

/**
 * Access JWT plus rotating opaque refresh token (architecture §6.1). One sign-in is one family; the family id is the
 * session id `sid`, so revoking a family also revokes the access tokens that carry it.
 * A refusal is a null result, not an exception, so the audit entry and any family delete still commit.
 */
@Service
class RefreshService(
    private val em: EntityManager,
    private val users: UserService,
    private val roles: RoleService,
    private val signer: TokenSigner,
    private val tokens: SecureTokens,
    private val bidx: BlindIndex,
    private val epoch: PermissionEpoch,
    private val sessions: SessionRegistry,
    private val audit: AuditService,
) {
    internal var clock: Clock = Clock.systemUTC()

    /** First token of a new family. Null when the User may not sign in (missing, not active, or a Role with no Permission). */
    @Transactional
    fun start(userId: UUID, keep: Boolean): TokenPair? {
        val perms = permissionsOf(userId) ?: return null
        val now = clock.instant()
        val first = RefreshToken(UUID.randomUUID(), userId, UUID.randomUUID(), tokens.newToken(), now.plus(if (keep) KEEP else DAY))
        em.persist(first)
        return pair(userId, first, perms, now)
    }

    /**
     * Rotate (403 when the User's Role holds no Permission, else a refusal is null). A spent token is honoured for [GRACE] and returns the same successor (two windows racing); after that
     * it is theft or a replay, so the whole family goes and an Audit Entry says so.
     * The new token keeps the family's end date: a sign-in lasts 24 h or 30 days in total, it does not slide.
     */
    @Transactional(noRollbackFor = [ProblemException::class])
    fun rotate(presented: String, ip: String): TokenPair? {
        val t = find(presented) ?: return null
        val now = clock.instant()
        val spent = t.spentAt
        if (spent != null) {
            val next = t.successorId?.let { em.find(RefreshToken::class.java, it) }
            if (next != null && Duration.between(spent, now) <= GRACE && next.spentAt == null) {
                val perms = permissionsOf(t.userId) ?: return null
                return pair(t.userId, next, perms, now)
            }
            revokeFamily(t.familyId)
            audit.record(AuditAction.REFRESH_REUSE, actorId = t.userId, ip = ip)
            return null
        }
        if (!t.expiresAt.isAfter(now)) return null
        val perms = permissionsOf(t.userId)
        if (perms == null) {
            val locked = hasNoPermission(t.userId)
            revokeFamily(t.familyId)
            // 403 tells the shell why it is signed out: the Role holds no Permission (architecture §5.4).
            if (locked) { audit.record(AuditAction.SIGN_IN_NO_ACCESS, actorId = t.userId, ip = ip); throw ProblemException(ProblemCode.FORBIDDEN) }
            return null
        }
        // shortcut: two truly concurrent rotations of one token meet in @Version and the loser gets a 500; the desktop shell refreshes single-flight.
        val next = RefreshToken(UUID.randomUUID(), t.userId, t.familyId, tokens.newToken(), t.expiresAt)
        em.persist(next)
        t.spentAt = now
        t.successorId = next.id
        return pair(t.userId, next, perms, now)
    }

    /** Ends the sign-in of the presented token. Unknown or already gone is the same quiet success. */
    @Transactional
    fun logout(presented: String) {
        val t = find(presented) ?: return
        revokeFamily(t.familyId)
    }

    /** Ends every sign-in of a User (password reset). Clears the persistence context, so callers flush their own changes first. */
    @Transactional
    fun revokeAllFor(userId: UUID) {
        em.createQuery("select distinct t.familyId from RefreshToken t where t.userId = :u", UUID::class.java)
            .setParameter("u", userId).resultList.forEach(::revokeFamily)
    }

    /** Ends every sign-in of a User except [keep] (password change). Clears the persistence context, so callers flush their own changes first. */
    @Transactional
    fun revokeOthers(userId: UUID, keep: UUID) {
        em.createQuery("select distinct t.familyId from RefreshToken t where t.userId = :u and t.familyId <> :k", UUID::class.java)
            .setParameter("u", userId).setParameter("k", keep).resultList.forEach(::revokeFamily)
    }

    private fun find(presented: String): RefreshToken? {
        if (presented.length != TOKEN_LENGTH) return null
        return em.createQuery("select t from RefreshToken t where t.tokenBidx = :b", RefreshToken::class.java)
            .setParameter("b", bidx.of(BidxDomain.REFRESH, presented)).resultList.firstOrNull()
    }

    private fun revokeFamily(family: UUID) {
        em.createQuery("delete from RefreshToken t where t.familyId = :f").setParameter("f", family).executeUpdate()
        sessions.revoke(family.toString())
        em.clear()
    }

    private fun hasNoPermission(userId: UUID): Boolean =
        users.get(userId)?.takeIf { it.status == UserStatus.ACTIVE }?.let { roles.permissions(it.roleId).isEmpty() } ?: false

    /** Sorted Permission names, or null when this User may not hold a session. */
    private fun permissionsOf(userId: UUID): List<String>? {
        val u = users.get(userId)?.takeIf { it.status == UserStatus.ACTIVE } ?: return null
        return roles.permissions(u.roleId).map { it.name }.sorted().takeIf { it.isNotEmpty() }
    }

    private fun pair(userId: UUID, t: RefreshToken, perms: List<String>, now: Instant): TokenPair {
        users.get(userId)?.let { users.touch(it, now) }
        val iat = now.epochSecond
        val access = signer.sign(TokenClaims(userId.toString(), perms, t.familyId.toString(), epoch.current(), iat, iat + ACCESS.seconds))
        return TokenPair(access, t.token, ACCESS.seconds)
    }

    companion object {
        val ACCESS: Duration = Duration.ofMinutes(15)
        val DAY: Duration = Duration.ofHours(24)
        val KEEP: Duration = Duration.ofDays(30)
        val GRACE: Duration = Duration.ofSeconds(10)
        const val TOKEN_LENGTH = 43
    }
}
