package co.klei.crypto

import java.nio.file.Files
import java.nio.file.Path
import java.util.Base64

/** Names the variables at fault, never a value. */
class KeyRingException(val code: String, val variables: List<String>) :
    RuntimeException("$code: ${variables.joinToString()}")

/** Keys from the environment (architecture §9.2). Every key may also be given as `<NAME>_FILE`. */
class KeyRing private constructor(
    internal val keks: Map<Int, ByteArray>,
    val activeKek: Int,
    internal val bidxKey: ByteArray,
    internal val jwtKey: ByteArray,
) {
    companion object {
        private val KEK = Regex("KLEI_KEK_([0-9]+)")
        private val FILE = Regex("(KLEI_KEK_[0-9]+|KLEI_BIDX_KEY|KLEI_JWT_KEY)_FILE")

        /** [otherSecrets] are non-key secrets (DB and SMTP passwords) that no key may equal. */
        fun parse(env: Map<String, String>, otherSecrets: Map<String, String> = emptyMap()): KeyRing {
            val e = readFiles(env)
            fun need(name: String) = e[name]?.takeIf { it.isNotBlank() } ?: throw KeyRingException("missing_variable", listOf(name))
            fun bytes(name: String, min: Int, exact: Boolean): ByteArray {
                val text = need(name)
                val b = runCatching { Base64.getDecoder().decode(text) }.getOrNull()
                if (b == null || (if (exact) b.size != min else b.size < min)) throw KeyRingException("malformed_variable", listOf(name))
                return b
            }

            val active = need("KLEI_KEK_ACTIVE").toIntOrNull()?.takeIf { it > 0 }
                ?: throw KeyRingException("malformed_variable", listOf("KLEI_KEK_ACTIVE"))
            need("KLEI_KEK_$active")
            // A blank KLEI_KEK_<n> is an unset slot (compose forwards KLEI_KEK_2..4 empty until a rotation starts), not a malformed key.
            val keks = e.filterValues { it.isNotBlank() }.keys.mapNotNull { KEK.matchEntire(it)?.groupValues?.get(1)?.toInt() }.associateWith { bytes("KLEI_KEK_$it", 32, true) }
            val bidx = bytes("KLEI_BIDX_KEY", 32, true)
            val jwt = bytes("KLEI_JWT_KEY", 32, false)
            if (jwtSeed(jwt) == null) throw KeyRingException("malformed_variable", listOf("KLEI_JWT_KEY"))

            val names = keks.keys.map { "KLEI_KEK_$it" } + "KLEI_BIDX_KEY" + "KLEI_JWT_KEY"
            val secrets = names.associateWith { e.getValue(it) } + otherSecrets.filterValues { it.isNotBlank() }
            val clash = secrets.entries.groupBy({ it.value }, { it.key }).values.firstOrNull { it.size > 1 }
            if (clash != null) throw KeyRingException("duplicate_secret", clash.sorted())
            return KeyRing(keks, active, bidx, jwt)
        }

        /** `<NAME>_FILE` supplies `<NAME>` from a mounted secret file. A direct `<NAME>` wins. */
        private fun readFiles(env: Map<String, String>): Map<String, String> {
            val out = env.toMutableMap()
            for ((name, path) in env) {
                val target = FILE.matchEntire(name)?.groupValues?.get(1) ?: continue
                if (out[target].isNullOrBlank()) {
                    out[target] = runCatching { Files.readString(Path.of(path)).trim() }.getOrNull()
                        ?: throw KeyRingException("unreadable_file", listOf(name))
                }
            }
            return out
        }
    }
}
