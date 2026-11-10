package co.klei.crypto

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.serializer
import java.lang.reflect.Type
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * The only serializer for column values (architecture §5.2). Canonical forms, so a value compares the same after a round trip:
 * String UTF-8; Instant ISO-8601 UTC millis `Z`; Boolean `1`/`0`; numbers invariant ASCII; enums lowercase snake_case;
 * structured values camelCase JSON of one `@Serializable` class with a top-level `v`.
 */
object FieldCodec {
    @PublishedApi internal val json = Json { encodeDefaults = true; ignoreUnknownKeys = false }
    private val instantFormat = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC)

    fun enc(v: String) = v.toByteArray(Charsets.UTF_8)
    fun enc(v: Instant) = enc(instantFormat.format(v))
    fun enc(v: Boolean) = enc(if (v) "1" else "0")
    fun enc(v: Int) = enc(v.toString())
    fun enc(v: Long) = enc(v.toString())
    fun enc(v: Enum<*>) = enc(snake(v.name))

    fun decString(b: ByteArray) = String(b, Charsets.UTF_8)
    fun decInstant(b: ByteArray): Instant = Instant.from(instantFormat.parse(decString(b)))
    fun decBoolean(b: ByteArray) = when (decString(b)) { "1" -> true; "0" -> false; else -> throw CryptoException("bad_value") }
    fun decInt(b: ByteArray) = decString(b).toIntOrNull() ?: throw CryptoException("bad_value")
    fun decLong(b: ByteArray) = decString(b).toLongOrNull() ?: throw CryptoException("bad_value")
    fun <E : Enum<E>> decEnum(b: ByteArray, type: Class<E>): E =
        type.enumConstants.firstOrNull { snake(it.name) == decString(b) } ?: throw CryptoException("bad_value")

    inline fun <reified T> encJson(v: T): ByteArray = encJson(v, kotlinx.serialization.serializer<T>())
    inline fun <reified T> decJson(b: ByteArray): T = decJson(b, kotlinx.serialization.serializer<T>())

    fun <T> encJson(v: T, s: kotlinx.serialization.KSerializer<T>): ByteArray {
        val text = json.encodeToString(s, v)
        if ("v" !in json.parseToJsonElement(text).jsonObject) throw CryptoException("structured_value_needs_v")
        return enc(text)
    }

    fun <T> decJson(b: ByteArray, s: kotlinx.serialization.KSerializer<T>): T {
        val text = decString(b)
        if ("v" !in (json.parseToJsonElement(text) as? JsonObject ?: throw CryptoException("bad_value"))) throw CryptoException("bad_value")
        return json.decodeFromString(s, text)
    }

    /** Reflection entry used by the listener for a field of declared [type]. [v] is non-null. */
    internal fun encodeAny(v: Any, type: Type): ByteArray = when (v) {
        is String -> enc(v)
        is Instant -> enc(v)
        is Boolean -> enc(v)
        is Int -> enc(v)
        is Long -> enc(v)
        is Enum<*> -> enc(v)
        else -> encJson(v, json.serializersModule.serializer(type))
    }

    internal fun decodeAny(b: ByteArray, type: Type): Any = when {
        type == String::class.java -> decString(b)
        type == Instant::class.java -> decInstant(b)
        type == Boolean::class.javaObjectType || type == Boolean::class.javaPrimitiveType -> decBoolean(b)
        type == Int::class.javaObjectType || type == Int::class.javaPrimitiveType -> decInt(b)
        type == Long::class.javaObjectType || type == Long::class.javaPrimitiveType -> decLong(b)
        type is Class<*> && type.isEnum ->
            type.enumConstants.firstOrNull { snake((it as Enum<*>).name) == decString(b) } ?: throw CryptoException("bad_value")
        else -> decJson(b, json.serializersModule.serializer(type))!!
    }

    private fun snake(name: String) = name.replace(Regex("(?<=[a-z0-9])(?=[A-Z])"), "_").lowercase(Locale.ROOT)
}
