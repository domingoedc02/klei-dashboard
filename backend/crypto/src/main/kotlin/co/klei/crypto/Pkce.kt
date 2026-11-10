package co.klei.crypto

import java.util.Base64

/** RFC 7636 S256 for the sign-in code exchange. Lives here because only `Jca` may touch `MessageDigest` (AD-2). */
object Pkce {
    private val VERIFIER = Regex("[A-Za-z0-9._~-]{43,128}")

    fun s256(verifier: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(Jca.sha256(verifier.toByteArray(Charsets.US_ASCII)))

    fun validVerifier(v: String): Boolean = VERIFIER.matches(v)

    /** A challenge is the unpadded base64url of a SHA-256 digest: exactly 43 characters. */
    fun validChallenge(c: String): Boolean = c.length == 43 && c.all { it.isLetterOrDigit() || it == '-' || it == '_' }

    fun matches(verifier: String, challenge: String): Boolean =
        validVerifier(verifier) && Jca.constantTimeEquals(s256(verifier).toByteArray(), challenge.toByteArray())
}
