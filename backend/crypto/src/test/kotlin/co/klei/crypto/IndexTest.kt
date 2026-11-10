package co.klei.crypto

import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class IndexTest {
    private val bidx = BlindIndex(KeyRing.parse(testEnv()))

    @Test fun `canon makes Marie Curie variants equal`() {
        val a = bidx.of(BidxDomain.GOWN_TERM, " Marie CURIE ")
        assertContentEquals(a, bidx.of(BidxDomain.GOWN_TERM, "marie curie"))
        assertContentEquals(a, bidx.of(BidxDomain.GOWN_TERM, "Marie\t\n  Curie"))
        assertEquals(32, a.size)
    }

    @Test fun `fullwidth and ligature forms fold by NFKC`() =
        assertContentEquals(bidx.of(BidxDomain.APP_USER_EMAIL, "ab@x.com"), bidx.of(BidxDomain.APP_USER_EMAIL, "ａｂ@x.com"))

    @Test fun `same value in two domains differs`() =
        assertFalse(bidx.of(BidxDomain.GOWN_TERM, "silk").contentEquals(bidx.of(BidxDomain.INQUIRY_TERM, "silk")))

    @Test fun `another bidx key gives another hash`() {
        val other = BlindIndex(KeyRing.parse(testEnv() + ("KLEI_BIDX_KEY" to testKey(77))))
        assertFalse(bidx.of(BidxDomain.GOWN_TERM, "silk").contentEquals(other.of(BidxDomain.GOWN_TERM, "silk")))
    }

    @Test fun `terms split canon dedupe drop long and cap`() {
        assertEquals(listOf("lace", "a-line".split("-")[0], "line", "ivory", "café"), Terms.of("Lace, A-line; IVORY lace  Café"))
        assertEquals(emptyList(), Terms.of("   ---  "))
        assertEquals(listOf("short"), Terms.of("short " + "x".repeat(65)))
        assertEquals(listOf("x".repeat(64)), Terms.of("x".repeat(64)))
        assertEquals(32, Terms.of((1..40).joinToString(" ") { "w$it" }).size)
        assertEquals("w1", Terms.of((1..40).joinToString(" ") { "w$it" }).first())
    }

    @Test fun `day bucket is utc and lastN counts today`() {
        assertEquals("2026-03-05", DayBucket.of(Instant.parse("2026-03-05T23:59:59Z")))
        assertEquals("2026-03-06", DayBucket.of(Instant.parse("2026-03-06T00:00:00Z")))
        assertEquals(listOf("2026-03-05", "2026-03-04", "2026-03-03"), DayBucket.lastN(3, Instant.parse("2026-03-05T01:00:00Z")))
    }

    @Test fun `tokens are random 256 bit and codes are six digits`() {
        val t = SecureTokens(bidx)
        assertEquals(43, t.newToken().length)
        assertFalse(t.newToken() == t.newToken())
        repeat(200) { assertTrue(Regex("\\d{6}").matches(t.newCode())) }
        assertTrue(t.equal(t.codeMac("123456"), t.codeMac("123456")))
        assertFalse(t.equal(t.codeMac("123456"), t.codeMac("123457")))
    }
}
