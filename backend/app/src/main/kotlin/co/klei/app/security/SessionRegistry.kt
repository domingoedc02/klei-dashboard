package co.klei.app.security

import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap
import org.springframework.stereotype.Component

/**
 * In-memory session state (A1, ADR-16). A restart voids every access token: tokens issued before
 * [startedAt] are stale, because the revocation list below is lost with the process.
 */
@Component
class SessionRegistry {
    val startedAt: Instant = Instant.now()
    private val revoked = ConcurrentHashMap<String, Instant>()

    /** Entries only matter while a token of that session can still be valid, so they expire after one token lifetime. */
    fun revoke(sid: String) {
        val now = Instant.now()
        revoked.values.removeIf { it.isBefore(now) }
        revoked[sid] = now.plus(LIFETIME)
    }

    fun isRevoked(sid: String): Boolean = revoked[sid]?.isAfter(Instant.now()) == true

    companion object {
        val LIFETIME: Duration = Duration.ofMinutes(16)
    }
}
