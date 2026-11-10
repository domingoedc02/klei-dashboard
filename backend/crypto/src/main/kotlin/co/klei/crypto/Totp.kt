package co.klei.crypto

import java.nio.ByteBuffer

/**
 * RFC 6238 TOTP as authenticator apps use it: HMAC-SHA1, 6 digits, 30 s steps. Secrets travel as RFC 4648 base32 text.
 * [match] accepts the step before, at and after "now", and only a step later than the last one used (replay).
 */
object Totp {
    const val STEP_SECONDS = 30L
    private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

    /** 160 random bits, the size RFC 4226 recommends. */
    fun newSecret(): String = base32(Jca.random(20))

    /** 10 characters of base32 (50 bits). A byte masked to 5 bits is uniform because 256 is a multiple of 32. */
    fun newRecoveryCode(): String = Jca.random(10).joinToString("") { ALPHABET[it.toInt() and 31].toString() }

    fun stepAt(epochSeconds: Long): Long = epochSeconds / STEP_SECONDS

    fun code(secret: String, step: Long): String {
        val h = Jca.hmacSha1(unbase32(secret), ByteBuffer.allocate(8).putLong(step).array())
        val o = h[h.size - 1].toInt() and 0x0f
        val bin = ((h[o].toInt() and 0x7f) shl 24) or ((h[o + 1].toInt() and 0xff) shl 16) or ((h[o + 2].toInt() and 0xff) shl 8) or (h[o + 3].toInt() and 0xff)
        return (bin % 1_000_000).toString().padStart(6, '0')
    }

    /** The step [code] belongs to, or null. All three candidates are compared before answering, so timing does not say which one hit. */
    fun match(secret: String, code: String, nowEpochSeconds: Long, lastUsedStep: Long): Long? {
        if (code.length != 6 || !code.all { it in '0'..'9' }) return null
        val now = stepAt(nowEpochSeconds)
        var hit: Long? = null
        for (s in now - 1..now + 1) {
            val same = Jca.constantTimeEquals(code.toByteArray(), code(secret, s).toByteArray())
            if (same && s > lastUsedStep) hit = s
        }
        return hit
    }

    fun base32(b: ByteArray): String {
        val out = StringBuilder()
        var buf = 0
        var bits = 0
        for (x in b) {
            buf = (buf shl 8) or (x.toInt() and 0xff)
            bits += 8
            while (bits >= 5) { out.append(ALPHABET[(buf shr (bits - 5)) and 31]); bits -= 5 }
            buf = buf and ((1 shl bits) - 1)
        }
        if (bits > 0) out.append(ALPHABET[(buf shl (5 - bits)) and 31])
        return out.toString()
    }

    /** Lower case, spaces and `=` padding are accepted; any other character is a [CryptoException]. */
    fun unbase32(s: String): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        var buf = 0
        var bits = 0
        for (c in s.uppercase()) {
            if (c == ' ' || c == '=') continue
            val v = ALPHABET.indexOf(c)
            if (v < 0) throw CryptoException("bad_base32")
            buf = (buf shl 5) or v
            bits += 5
            if (bits >= 8) { out.write((buf shr (bits - 8)) and 0xff); bits -= 8 }
            buf = buf and ((1 shl bits) - 1)
        }
        return out.toByteArray()
    }
}
