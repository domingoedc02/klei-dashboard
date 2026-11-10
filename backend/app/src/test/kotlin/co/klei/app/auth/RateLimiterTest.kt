package co.klei.app.auth

import org.junit.jupiter.api.Test
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TestClock(var now: Instant = Instant.parse("2026-01-01T00:00:00Z")) : Clock() {
    override fun getZone() = ZoneOffset.UTC
    override fun withZone(zone: java.time.ZoneId?) = this
    override fun instant(): Instant = now
    fun advance(d: Duration) { now = now.plus(d) }
}

class RateLimiterTest {
    private val clock = TestClock()
    private val limiter = RateLimiter().also { it.clock = clock }

    @Test fun `fifth failure locks the account for a minute, then the delay doubles`() {
        repeat(4) { assertFalse(limiter.fail("a", "ip"), "failure ${it + 1}"); assertNull(limiter.retryAfter("a", "ip")) }
        assertTrue(limiter.fail("a", "ip"))
        assertEquals(Duration.ofMinutes(1), limiter.retryAfter("a", "ip"))
        clock.advance(Duration.ofSeconds(61))
        assertNull(limiter.retryAfter("a", "ip"))
        assertFalse(limiter.fail("a", "ip"))
        assertEquals(Duration.ofMinutes(2), limiter.retryAfter("a", "ip"))
    }

    @Test fun `failures older than the window are forgotten and success clears the account`() {
        repeat(4) { limiter.fail("a", "ip") }
        clock.advance(Duration.ofMinutes(16))
        assertFalse(limiter.fail("a", "ip"))
        assertNull(limiter.retryAfter("a", "ip"))
        repeat(3) { limiter.fail("b", "other") }
        limiter.clear("b")
        repeat(4) { assertFalse(limiter.fail("b", "other")) }
    }

    @Test fun `twenty failures from one address lock it whatever the accounts`() {
        repeat(20) { limiter.fail("acct-$it", "10.0.0.9") }
        assertNotNull(limiter.retryAfter("fresh", "10.0.0.9"))
        assertNull(limiter.retryAfter("fresh", "10.0.0.10"))
    }
}
