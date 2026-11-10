package co.klei.app.identity

import co.klei.core.identity.UserStatus
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.PasswordHasher
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Duration
import java.time.Instant
import java.util.UUID

@Service
class UserService(private val em: EntityManager, private val passwords: PasswordHasher, private val bidx: BlindIndex) {
    /** Sign-in and uniqueness lookup: exact match on the email blind index. */
    @Transactional(readOnly = true)
    fun find(email: String): AppUser? =
        em.createQuery("select u from AppUser u where u.emailBidx = :b", AppUser::class.java)
            .setParameter("b", bidx.of(BidxDomain.APP_USER_EMAIL, email)).resultList.firstOrNull()

    @Transactional(readOnly = true)
    fun get(id: UUID): AppUser? = em.find(AppUser::class.java, id)

    /** Callers validate the password policy at their boundary; this only hashes and stores. */
    @Transactional
    fun create(name: String, email: String, password: String, roleId: UUID, status: UserStatus, verified: Boolean): AppUser =
        AppUser(UUID.randomUUID(), name, email.trim(), passwords.hash(password), roleId, status, verified, Instant.now())
            .also(em::persist)

    /** Writes pending changes now, so a version or a later bulk statement sees them. */
    fun flush() = em.flush()

    /** "Last active" moves at most once an hour per User; the caller's transaction commits it. */
    fun touch(u: AppUser, now: Instant) {
        if (u.lastActive?.isAfter(now.minus(Duration.ofHours(1))) != true) u.lastActive = now
    }
}
