package co.klei.crypto

import java.util.Base64

class SecureTokens internal constructor(private val bidx: BlindIndex) {
    /** 256-bit random token, URL-safe base64 without padding. */
    fun newToken(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(Jca.random(32))

    /** 6-digit code, uniform. */
    fun newCode(): String = (java.math.BigInteger(1, Jca.random(8)).mod(java.math.BigInteger.valueOf(1_000_000))).toInt().toString().padStart(6, '0')

    /** Code MAC with the CREDENTIAL domain key; compare with [equal] (architecture §4.2). */
    fun codeMac(code: String): ByteArray = bidx.of(BidxDomain.CREDENTIAL, code)

    fun equal(a: ByteArray, b: ByteArray): Boolean = Jca.constantTimeEquals(a, b)
}
