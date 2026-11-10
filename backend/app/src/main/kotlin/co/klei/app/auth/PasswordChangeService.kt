package co.klei.app.auth

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import co.klei.core.identity.PasswordPolicy
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.PasswordHasher
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.HexFormat
import java.util.UUID

/**
 * FR-30. A wrong current password counts toward the account's sign-in throttle, so a stolen access token cannot be used to guess it.
 * The sign-in the change was made from stays; every other one ends. The Permission epoch is not bumped.
 */
@Service
class PasswordChangeService(
    private val users: UserService,
    private val hasher: PasswordHasher,
    private val refresh: RefreshService,
    private val limiter: RateLimiter,
    private val bidx: BlindIndex,
    private val audit: AuditService,
) {
    @Transactional(noRollbackFor = [ProblemException::class])
    fun change(userId: UUID, family: UUID, current: String, new: String, ip: String) {
        val u = users.get(userId) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        val (name, email) = u.name to u.email
        val key = HexFormat.of().formatHex(bidx.of(BidxDomain.APP_USER_EMAIL, email))
        if (limiter.retryAfter(key, ip) != null) throw ProblemException(ProblemCode.RATE_LIMITED)
        if (!hasher.verify(current, u.password)) {
            if (limiter.fail(key, ip)) audit.record(AuditAction.SIGN_IN_LOCKED, actorId = userId, actorName = name, ip = ip)
            throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("current", "incorrect")))
        }
        if (!PasswordPolicy.accepts(new)) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("new", "invalid")))
        u.password = hasher.hash(new)
        users.flush()
        refresh.revokeOthers(userId, family)
        limiter.clear(key)
        audit.record(AuditAction.PASSWORD_CHANGED, actorId = userId, actorName = name, ip = ip)
    }
}
