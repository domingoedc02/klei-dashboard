package co.klei.crypto

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TotpTest {
    // RFC 6238 appendix B, SHA-1 key "12345678901234567890"; the RFC lists 8 digits, an app shows the last 6.
    private val key = Totp.base32("12345678901234567890".toByteArray())
    private val vectors = mapOf(59L to "287082", 1111111109L to "081804", 1111111111L to "050471", 1234567890L to "005924", 2000000000L to "279037", 20000000000L to "353130")

    @Test fun `matches the RFC 6238 SHA-1 vectors`() {
        vectors.forEach { (t, code) -> assertEquals(code, Totp.code(key, Totp.stepAt(t)), "t=$t") }
    }

    @Test fun `accepts the previous, current and next step and nothing two away`() {
        val now = 1111111109L
        val step = Totp.stepAt(now)
        listOf(step - 1, step, step + 1).forEach { assertEquals(it, Totp.match(key, Totp.code(key, it), now, 0), "step $it") }
        listOf(step - 2, step + 2).forEach { assertNull(Totp.match(key, Totp.code(key, it), now, 0), "step $it") }
    }

    @Test fun `a step used once is refused again, and so is an older one`() {
        val now = 1111111109L
        val step = Totp.stepAt(now)
        val used = Totp.match(key, Totp.code(key, step), now, 0)
        assertEquals(step, used)
        assertNull(Totp.match(key, Totp.code(key, step), now, used!!))
        assertNull(Totp.match(key, Totp.code(key, step - 1), now, used))
        assertEquals(step + 1, Totp.match(key, Totp.code(key, step + 1), now, used))
    }

    @Test fun `malformed codes never match`() {
        listOf("", "12345", "1234567", "12345a", "２８７０８２", " 28708").forEach { assertNull(Totp.match(key, it, 59, 0), it) }
    }

    @Test fun `base32 round trips and reads lower case, spaces and padding`() {
        (0..40).forEach { n ->
            val b = Jca.random(n)
            assertContentEquals(b, Totp.unbase32(Totp.base32(b)))
        }
        assertEquals("MZXW6", Totp.base32("foo".toByteArray()))
        assertContentEquals("foo".toByteArray(), Totp.unbase32("mz xw6==="))
        assertFailsWith<CryptoException> { Totp.unbase32("MZXW1") }
    }

    @Test fun `secrets and recovery codes have the promised shape and differ`() {
        assertTrue(Regex("[A-Z2-7]{32}").matches(Totp.newSecret()))
        assertTrue(Regex("[A-Z2-7]{10}").matches(Totp.newRecoveryCode()))
        assertTrue(Totp.newSecret() != Totp.newSecret())
    }
}
