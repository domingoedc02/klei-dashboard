package co.klei.app.auth

import org.springframework.stereotype.Component
import java.time.Clock
import java.time.Duration
import java.time.Instant

/**
 * Sign-in throttle: 5 failures per account or 20 per client IP in 15 minutes, then a delay that doubles with every
 * further failure up to 15 minutes. Attempts made while locked are not counted, so the delay always ends.
 * shortcut: in memory and per instance; a restart forgets all counters. Move to a table when the backend scales out.
 */
@Component
class RateLimiter {
    internal var clock: Clock = Clock.systemUTC()
    private val accounts = HashMap<String, ArrayDeque<Instant>>()
    private val ips = HashMap<String, ArrayDeque<Instant>>()

    /** Time left on a lockout, or null when the attempt may go ahead. */
    @Synchronized fun retryAfter(account: String, ip: String): Duration? {
        val now = clock.instant()
        return listOfNotNull(left(accounts[account], ACCOUNT_LIMIT, now), left(ips[ip], IP_LIMIT, now)).maxOrNull()
    }

    /** Records a failure; true when it is the one that starts an account lockout. */
    @Synchronized fun fail(account: String, ip: String): Boolean {
        val now = clock.instant()
        if (accounts.size > PRUNE_AT || ips.size > PRUNE_AT) { prune(accounts, now); prune(ips, now) }
        val a = accounts.getOrPut(account) { ArrayDeque() }.also { trim(it, now); it.addLast(now) }
        trim(ips.getOrPut(ip) { ArrayDeque() }.also { it.addLast(now) }, now)
        return a.size == ACCOUNT_LIMIT
    }

    @Synchronized fun clear(account: String) { accounts.remove(account) }

    private fun left(list: ArrayDeque<Instant>?, limit: Int, now: Instant): Duration? {
        if (list == null) return null
        trim(list, now)
        if (list.size < limit) return null
        val minutes = minOf(1L shl minOf(list.size - limit, 4), 15L)
        return Duration.between(now, list.last().plus(Duration.ofMinutes(minutes))).takeIf { !it.isNegative && !it.isZero }
    }

    private fun trim(list: ArrayDeque<Instant>, now: Instant) {
        while (list.isNotEmpty() && list.first().isBefore(now.minus(WINDOW))) list.removeFirst()
    }

    private fun prune(m: HashMap<String, ArrayDeque<Instant>>, now: Instant) {
        m.values.forEach { trim(it, now) }
        m.values.removeIf { it.isEmpty() }
    }

    companion object {
        const val ACCOUNT_LIMIT = 5
        const val IP_LIMIT = 20
        const val PRUNE_AT = 10_000
        val WINDOW: Duration = Duration.ofMinutes(15)
    }
}
