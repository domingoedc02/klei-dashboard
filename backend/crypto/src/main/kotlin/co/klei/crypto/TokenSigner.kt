package co.klei.crypto

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.Json
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.time.Instant
import java.util.Base64

/** Access token claims (architecture §6.1). Times are epoch seconds. */
data class TokenClaims(val sub: String, val perms: List<String>, val sid: String, val epoch: Long, val iat: Long, val exp: Long)

private val PKCS8_PREFIX = byteArrayOf(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20)

/** `KLEI_JWT_KEY` is a 32-byte Ed25519 seed or the 48-byte PKCS8 DER that `gen-keys.sh` emits. Null when it is neither. */
internal fun jwtSeed(key: ByteArray): ByteArray? = when {
    key.size == 32 -> key
    key.size == 48 && key.copyOf(16).contentEquals(PKCS8_PREFIX) -> key.copyOfRange(16, 48)
    else -> null
}

/** Compact JWS, alg EdDSA, with a `kid` (architecture §6.1). [verify] returns null for anything not a valid, unexpired token of this key. */
class TokenSigner internal constructor(key: ByteArray) {
    private val priv = Ed25519PrivateKeyParameters(jwtSeed(key) ?: throw KeyRingException("malformed_variable", listOf("KLEI_JWT_KEY")), 0)
    private val pub = priv.generatePublicKey()
    val kid: String = pub.encoded.take(8).joinToString("") { "%02x".format(it) }

    private val header = b64(buildJsonObject { put("alg", "EdDSA"); put("typ", "JWT"); put("kid", kid) }.toString().toByteArray())

    fun sign(c: TokenClaims): String {
        val payload = buildJsonObject {
            put("sub", c.sub)
            putJsonArray("perms") { c.perms.forEach { add(JsonPrimitive(it)) } }
            put("sid", c.sid); put("epoch", c.epoch); put("iat", c.iat); put("exp", c.exp)
        }.toString()
        val input = "$header.${b64(payload.toByteArray())}"
        val s = Ed25519Signer().apply { init(true, priv); update(input.toByteArray(), 0, input.length) }.generateSignature()
        return "$input.${b64(s)}"
    }

    fun verify(token: String, now: Instant = Instant.now()): TokenClaims? = runCatching {
        if (token.length > MAX_LEN) return null
        val p = token.split('.')
        if (p.size != 3) return null
        val h = Json.parseToJsonElement(String(unb64(p[0]))).jsonObject
        if (h["alg"]?.jsonPrimitive?.contentOrNull != "EdDSA" || h["kid"]?.jsonPrimitive?.contentOrNull != kid) return null
        val input = "${p[0]}.${p[1]}"
        val ok = Ed25519Signer().apply { init(false, pub); update(input.toByteArray(), 0, input.length) }.verifySignature(unb64(p[2]))
        if (!ok) return null
        val o = Json.parseToJsonElement(String(unb64(p[1]))).jsonObject
        val c = TokenClaims(
            o.getValue("sub").jsonPrimitive.content,
            (o.getValue("perms") as JsonArray).map { it.jsonPrimitive.content },
            o.getValue("sid").jsonPrimitive.content,
            o.getValue("epoch").jsonPrimitive.long,
            o.getValue("iat").jsonPrimitive.long,
            o.getValue("exp").jsonPrimitive.long,
        )
        c.takeIf { it.exp > now.epochSecond }
    }.getOrNull()

    private companion object {
        const val MAX_LEN = 8192
        fun b64(b: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(b)
        fun unb64(s: String): ByteArray = Base64.getUrlDecoder().decode(s)
    }
}
