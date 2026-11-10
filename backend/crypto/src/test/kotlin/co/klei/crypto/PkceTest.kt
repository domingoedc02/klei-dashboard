package co.klei.crypto

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class PkceTest {
    // RFC 7636 appendix B.
    private val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    private val challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

    @Test fun `matches the RFC 7636 test vector`() {
        assertEquals(challenge, Pkce.s256(verifier))
        assertTrue(Pkce.matches(verifier, challenge))
        assertTrue(Pkce.validChallenge(challenge))
    }

    @Test fun `rejects a wrong or malformed verifier`() {
        assertFalse(Pkce.matches(verifier.reversed(), challenge))
        assertFalse(Pkce.matches("short", challenge))
        assertFalse(Pkce.validChallenge("not-43-chars"))
    }
}
