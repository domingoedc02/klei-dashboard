package co.klei.app.auth

import co.klei.crypto.SecureTokens
import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Authorization codes (AD-8): 60 s, single use, bound to client, redirect and challenge, held in memory only.
 * shortcut: a restart drops pending codes (the user signs in again) and one instance only; move to a table if the backend ever scales out.
 */
@Component
class AuthCodeStore(private val tokens: SecureTokens) {
    data class Entry(
        val userId: UUID, val keep: Boolean, val client: String, val redirect: String, val challenge: String, val expires: Instant,
    )

    internal var clock: Clock = Clock.systemUTC()
    private val codes = ConcurrentHashMap<String, Entry>()

    fun issue(userId: UUID, keep: Boolean, client: String, redirect: String, challenge: String): String {
        val now = clock.instant()
        codes.values.removeIf { it.expires.isBefore(now) }
        val code = tokens.newToken()
        codes[code] = Entry(userId, keep, client, redirect, challenge, now.plus(TTL))
        return code
    }

    /** Removes the code whether or not it is still valid, so a second try always fails. */
    fun redeem(code: String): Entry? = codes.remove(code)?.takeIf { it.expires.isAfter(clock.instant()) }

    companion object { val TTL: Duration = Duration.ofSeconds(60) }
}

/** The only redirect targets the desktop app can own: its Deep Link, or a loopback listener (AD-8). Compared exactly. */
object RedirectUri {
    const val DEEP_LINK = "klei://auth/callback"
    private val LOOPBACK = Regex("""http://127\.0\.0\.1:([1-9][0-9]{3,4})/callback""")

    fun valid(s: String): Boolean =
        s == DEEP_LINK || LOOPBACK.matchEntire(s)?.groupValues?.get(1)?.toInt()?.let { it in 1024..65535 } == true
}
