package co.klei.app

import co.klei.app.boot.StartupCheckException
import co.klei.app.boot.StartupChecks
import org.junit.jupiter.api.Test
import java.util.Base64
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse

class StartupChecksTest {
    private fun key(seed: Int) = Base64.getEncoder().encodeToString(ByteArray(32) { (it + seed).toByte() })

    private val good = mapOf(
        "KLEI_DB_URL" to "jdbc:postgresql://h/d", "KLEI_DB_USER" to "u", "KLEI_DB_PASSWORD" to "pw-db-secret",
        "KLEI_S3_ENDPOINT" to "http://s3", "KLEI_S3_ACCESS_KEY" to "a", "KLEI_S3_SECRET_KEY" to "b", "KLEI_S3_BUCKET" to "bk", "KLEI_MAIL_FROM" to "studio@klei.example",
        "KLEI_KEK_ACTIVE" to "1", "KLEI_KEK_1" to key(1), "KLEI_BIDX_KEY" to key(2), "KLEI_JWT_KEY" to key(3),
    )

    @Test fun `valid environment passes`() = StartupChecks.verify(good)

    @Test fun `missing variable is named`() {
        val e = assertFailsWith<StartupCheckException> { StartupChecks.verify(good - "KLEI_S3_BUCKET") }
        assertEquals("missing_variable", e.code)
        assertEquals(listOf("KLEI_S3_BUCKET"), e.variables)
    }

    @Test fun `mail sender is required outside dev and test`() {
        val e = assertFailsWith<StartupCheckException> { StartupChecks.verify(good - "KLEI_MAIL_FROM") }
        assertEquals(listOf("KLEI_MAIL_FROM"), e.variables)
        StartupChecks.verify(good - "KLEI_MAIL_FROM" + ("SPRING_PROFILES_ACTIVE" to "dev"))
        StartupChecks.verify(good + ("KLEI_MAIL_FROM" to " ") + ("SPRING_PROFILES_ACTIVE" to "x, test"))
    }

    @Test fun `malformed key is named and its value never appears`() {
        val bad = "not-base64-secret-value!"
        val e = assertFailsWith<StartupCheckException> { StartupChecks.verify(good + ("KLEI_BIDX_KEY" to bad)) }
        assertEquals(listOf("KLEI_BIDX_KEY"), e.variables)
        assertFalse(e.message!!.contains(bad))
    }

    @Test fun `active key must exist`() {
        val e = assertFailsWith<StartupCheckException> { StartupChecks.verify(good + ("KLEI_KEK_ACTIVE" to "2")) }
        assertEquals(listOf("KLEI_KEK_2"), e.variables)
    }

    @Test fun `keys must be pairwise distinct`() {
        val e = assertFailsWith<StartupCheckException> { StartupChecks.verify(good + ("KLEI_BIDX_KEY" to key(1))) }
        assertEquals("duplicate_secret", e.code)
        assertEquals(listOf("KLEI_BIDX_KEY", "KLEI_KEK_1"), e.variables)
    }
}
