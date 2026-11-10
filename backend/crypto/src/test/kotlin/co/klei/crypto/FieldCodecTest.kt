package co.klei.crypto

import kotlinx.serialization.Serializable
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

enum class Phase { EMPTY, PROCESSING, InReview }

@Serializable data class Attr(val v: Int = 1, val typeName: String, val items: List<String>)
@Serializable data class NoVersion(val a: Int)

class FieldCodecTest {
    private fun s(b: ByteArray) = String(b, Charsets.UTF_8)

    @Test fun `canonical forms`() {
        assertEquals("2026-03-05T01:02:03.000Z", s(FieldCodec.enc(Instant.parse("2026-03-05T01:02:03Z"))))
        assertEquals("2026-03-05T01:02:03.456Z", s(FieldCodec.enc(Instant.parse("2026-03-05T01:02:03.456789Z"))))
        assertEquals("1", s(FieldCodec.enc(true)))
        assertEquals("0", s(FieldCodec.enc(false)))
        assertEquals("-1234567", s(FieldCodec.enc(-1234567)))
        assertEquals("processing", s(FieldCodec.enc(Phase.PROCESSING)))
        assertEquals("in_review", s(FieldCodec.enc(Phase.InReview)))
    }

    @Test fun `round trips`() {
        assertEquals("héllo 中", FieldCodec.decString(FieldCodec.enc("héllo 中")))
        val t = Instant.parse("2026-03-05T01:02:03.456Z")
        assertEquals(t, FieldCodec.decInstant(FieldCodec.enc(t)))
        assertEquals(true, FieldCodec.decBoolean(FieldCodec.enc(true)))
        assertEquals(Int.MIN_VALUE, FieldCodec.decInt(FieldCodec.enc(Int.MIN_VALUE)))
        assertEquals(Long.MAX_VALUE, FieldCodec.decLong(FieldCodec.enc(Long.MAX_VALUE)))
        assertEquals(Phase.InReview, FieldCodec.decEnum(FieldCodec.enc(Phase.InReview), Phase::class.java))
        val a = Attr(typeName = "fabric", items = listOf("silk", "lace"))
        assertEquals("""{"v":1,"typeName":"fabric","items":["silk","lace"]}""", s(FieldCodec.encJson(a)))
        assertEquals(a, FieldCodec.decJson<Attr>(FieldCodec.encJson(a)))
    }

    @Test fun `reflection entry round trips every kind`() {
        for (v in listOf<Any>("x", Instant.parse("2026-03-05T01:02:03.456Z"), true, 7, 9L, Phase.EMPTY, Attr(typeName = "t", items = emptyList()))) {
            assertEquals(v, FieldCodec.decodeAny(FieldCodec.encodeAny(v, v.javaClass), v.javaClass))
        }
    }

    @Test fun `structured value without v and malformed scalars are refused`() {
        assertFailsWith<CryptoException> { FieldCodec.encJson(NoVersion(1)) }
        assertFailsWith<CryptoException> { FieldCodec.decBoolean(FieldCodec.enc("yes")) }
        assertFailsWith<CryptoException> { FieldCodec.decInt(FieldCodec.enc("12x")) }
        assertFailsWith<CryptoException> { FieldCodec.decEnum(FieldCodec.enc("nope"), Phase::class.java) }
    }
}
