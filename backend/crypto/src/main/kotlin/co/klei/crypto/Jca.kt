package co.klei.crypto

import java.security.GeneralSecurityException
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Thrown for every crypto failure. Carries a code only: never a blob, key, AAD or plaintext. */
class CryptoException(val code: String) : RuntimeException(code)

/** The only class in the code base that touches `Cipher`, `Mac`, `MessageDigest` or `SecureRandom` (AD-2). */
internal object Jca {
    private val rng = SecureRandom()

    fun random(n: Int): ByteArray = ByteArray(n).also(rng::nextBytes)

    /** AES-256-GCM. Returns ciphertext followed by the 16-byte tag. */
    fun seal(key: ByteArray, nonce: ByteArray, aad: ByteArray, plain: ByteArray): ByteArray = try {
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
            doFinal(plain)
        }
    } catch (_: GeneralSecurityException) {
        throw CryptoException("encrypt_failed")
    }

    fun open(key: ByteArray, nonce: ByteArray, aad: ByteArray, sealed: ByteArray): ByteArray = try {
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
            doFinal(sealed)
        }
    } catch (_: GeneralSecurityException) {
        throw CryptoException("decrypt_failed")
    }

    fun hmac(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run { init(SecretKeySpec(key, "HmacSHA256")); doFinal(data) }

    /** HMAC-SHA1 for TOTP only (RFC 6238 default of authenticator apps); nothing else may use SHA-1. */
    fun hmacSha1(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA1").run { init(SecretKeySpec(key, "HmacSHA1")); doFinal(data) }

    /** HKDF-SHA-256 (RFC 5869), zero salt, one 32-byte output block. */
    fun hkdf(ikm: ByteArray, info: String): ByteArray {
        val prk = hmac(ByteArray(32), ikm)
        return hmac(prk, info.toByteArray(Charsets.UTF_8) + 1.toByte())
    }

    fun sha256(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)

    fun constantTimeEquals(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)
}
