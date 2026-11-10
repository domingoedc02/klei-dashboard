package co.klei.crypto

import org.junit.jupiter.api.Test
import java.util.concurrent.Executors
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PasswordHasherTest {
    @Test fun `right password verifies and wrong does not`() {
        val h = PasswordHasher(memoryKb = 1024)
        val phc = h.hash("correct horse 9")
        assertTrue(h.verify("correct horse 9", phc))
        assertFalse(h.verify("correct horse 8", phc))
        assertFalse(h.verify("x", "not-a-hash"))
    }

    @Test fun `parameters are inside the string and salts differ`() {
        val h = PasswordHasher()
        val a = h.hash("same-pass-1")
        assertTrue(a.startsWith("\$argon2id\$v=19\$m=65536,t=3,p=1\$"), a)
        assertNotEquals(a, h.hash("same-pass-1"))
    }

    @Test fun `an old hash still verifies after the parameters are raised`() {
        val old = PasswordHasher(memoryKb = 1024, iterations = 1).hash("pw-old-1")
        assertTrue(PasswordHasher(memoryKb = 2048, iterations = 2).verify("pw-old-1", old))
    }

    @Test fun `over-long password is refused`() {
        val h = PasswordHasher(memoryKb = 1024)
        assertFailsWith<CryptoException> { h.hash("a".repeat(129)) }
        assertFalse(h.verify("a".repeat(129), h.hash("a".repeat(128))))
    }

    @Test fun `at most two hashes run at once`() {
        val h = PasswordHasher(memoryKb = 16384)
        val pool = Executors.newFixedThreadPool(8)
        (1..8).map { pool.submit { h.hash("pw-$it-x") } }.forEach { it.get() }
        pool.shutdown()
        assertEquals(2, h.peak.get())
    }
}
