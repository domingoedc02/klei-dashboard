package co.klei.crypto

import java.security.KeyPairGenerator
import java.time.Instant
import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class TokenSignerTest {
    private val now = Instant.parse("2026-01-01T00:00:00Z")
    private val signer = TokenSigner(ByteArray(32) { it.toByte() })
    private val claims = TokenClaims("u1", listOf("PERM_VIEW_GALLERY", "PERM_REPLY"), "s1", 3, now.epochSecond, now.epochSecond + 900)

    private fun b64(s: String) = Base64.getUrlEncoder().withoutPadding().encodeToString(s.toByteArray())

    @Test fun `a signed token verifies and carries its claims`() =
        assertEquals(claims, signer.verify(signer.sign(claims), now))

    @Test fun `expired token is refused`() {
        assertNotNull(signer.verify(signer.sign(claims), now.plusSeconds(899)))
        assertNull(signer.verify(signer.sign(claims), now.plusSeconds(900)))
    }

    @Test fun `tampered payload or signature is refused`() {
        val (h, p, s) = signer.sign(claims).split('.')
        val forged = b64("""{"sub":"u1","perms":["PERM_USER_MANAGE"],"sid":"s1","epoch":3,"iat":${claims.iat},"exp":${claims.exp}}""")
        assertNull(signer.verify("$h.$forged.$s", now))
        val flipped = (if (s.first() == 'A') "B" else "A") + s.drop(1)
        assertNull(signer.verify("$h.$p.$flipped", now))
    }

    @Test fun `a token of another key or kid is refused`() {
        val other = TokenSigner(ByteArray(32) { (it + 1).toByte() })
        assertNotEquals(signer.kid, other.kid)
        assertNull(signer.verify(other.sign(claims), now))
    }

    @Test fun `alg none, other alg and junk are refused`() {
        val (_, p, _) = signer.sign(claims).split('.')
        assertNull(signer.verify("${b64("""{"alg":"none","kid":"${signer.kid}"}""")}.$p.", now))
        assertNull(signer.verify("${b64("""{"alg":"HS256","kid":"${signer.kid}"}""")}.$p.AAAA", now))
        for (junk in listOf("", "a.b", "a.b.c", "....", "x".repeat(9000), "%%%.%%%.%%%")) assertNull(signer.verify(junk, now), junk.take(10))
    }

    @Test fun `seed and pkcs8 forms of one key sign alike`() {
        val der = KeyPairGenerator.getInstance("Ed25519").generateKeyPair().private.encoded
        assertEquals(48, der.size)
        val a = TokenSigner(der)
        val b = TokenSigner(der.copyOfRange(16, 48))
        assertEquals(a.kid, b.kid)
        assertEquals(a.sign(claims), b.sign(claims))
    }

    @Test fun `key that is neither seed nor pkcs8 is refused by the ring`() {
        assertFailsWith<KeyRingException> { TokenSigner(ByteArray(40)) }
        val e = assertFailsWith<KeyRingException> {
            KeyRing.parse(testEnv() + ("KLEI_JWT_KEY" to Base64.getEncoder().encodeToString(ByteArray(40) { (it + 90).toByte() })))
        }
        assertEquals(listOf("KLEI_JWT_KEY"), e.variables)
    }
}
