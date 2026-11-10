package co.klei.crypto

import java.nio.file.Files
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class KeyRingTest {
    private fun fail(env: Map<String, String>, other: Map<String, String> = emptyMap()) =
        assertFailsWith<KeyRingException> { KeyRing.parse(env, other) }

    @Test fun `valid environment parses and exposes the active kek number`() {
        assertEquals(2, KeyRing.parse(testEnv(active = 2, keks = 2)).activeKek)
    }

    @Test fun `missing key is named`() {
        for (name in listOf("KLEI_KEK_ACTIVE", "KLEI_KEK_1", "KLEI_BIDX_KEY", "KLEI_JWT_KEY")) {
            val e = fail(testEnv() - name)
            assertEquals("missing_variable", e.code, name)
            assertEquals(listOf(name), e.variables)
        }
    }

    @Test fun `active kek that is not configured is named`() =
        assertEquals(listOf("KLEI_KEK_3"), fail(testEnv(active = 3)).variables)

    @Test fun `not 32 bytes or not base64 is named and the value never appears`() {
        val short = java.util.Base64.getEncoder().encodeToString(ByteArray(16))
        val e = fail(testEnv() + ("KLEI_BIDX_KEY" to short))
        assertEquals("malformed_variable", e.code)
        assertEquals(listOf("KLEI_BIDX_KEY"), e.variables)
        val bad = "SENTINEL-not-base64!"
        assertFalse(fail(testEnv() + ("KLEI_KEK_1" to bad)).message!!.contains("SENTINEL"))
    }

    @Test fun `two equal keys are refused`() {
        val e = fail(testEnv() + ("KLEI_BIDX_KEY" to testKey(1)))
        assertEquals("duplicate_secret", e.code)
        assertEquals(listOf("KLEI_BIDX_KEY", "KLEI_KEK_1"), e.variables)
    }

    @Test fun `a key equal to the database or smtp password is refused`() {
        val e = fail(testEnv(), mapOf("KLEI_DB_PASSWORD" to testKey(1)))
        assertEquals(listOf("KLEI_DB_PASSWORD", "KLEI_KEK_1"), e.variables)
        assertEquals(listOf("KLEI_JWT_KEY", "KLEI_SMTP_PASSWORD"), fail(testEnv(), mapOf("KLEI_SMTP_PASSWORD" to testKey(60))).variables)
    }

    @Test fun `a key can come from a file`() {
        val f = Files.createTempFile("kek", ".b64").also { Files.writeString(it, testKey(1) + "\n") }
        try {
            val env = testEnv() - "KLEI_KEK_1" + ("KLEI_KEK_1_FILE" to f.toString())
            assertEquals(1, KeyRing.parse(env).activeKek)
            assertEquals("unreadable_file", fail(testEnv() - "KLEI_KEK_1" + ("KLEI_KEK_1_FILE" to "/nonexistent/x")).code)
        } finally { Files.delete(f) }
    }

    @Test fun `a blank non-active KEK slot is ignored, a blank active one is missing`() {
        assertEquals(listOf(1), KeyRing.parse(testEnv() + ("KLEI_KEK_2" to "")).keks.keys.toList())
        val e = assertFailsWith<KeyRingException> { KeyRing.parse(testEnv() + ("KLEI_KEK_ACTIVE" to "2") + ("KLEI_KEK_2" to "")) }
        assertEquals("missing_variable", e.code)
    }
}
