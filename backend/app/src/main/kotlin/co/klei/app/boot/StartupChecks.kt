package co.klei.app.boot

import co.klei.crypto.CryptoModule
import co.klei.crypto.KeyRingException

/** Names the variables at fault, never a value (architecture §9.2, checks 1 and 2). */
class StartupCheckException(val code: String, val variables: List<String>) :
    RuntimeException("$code: ${variables.joinToString()}")

object StartupChecks {
    private val REQUIRED = listOf(
        "KLEI_DB_URL", "KLEI_DB_USER", "KLEI_DB_PASSWORD",
        "KLEI_S3_ENDPOINT", "KLEI_S3_ACCESS_KEY", "KLEI_S3_SECRET_KEY", "KLEI_S3_BUCKET",
    )

    /** Non-key secrets that no key may equal. */
    fun otherSecrets(env: Map<String, String>) =
        listOf("KLEI_DB_PASSWORD", "KLEI_SMTP_PASSWORD").mapNotNull { n -> env[n]?.takeIf { it.isNotBlank() }?.let { n to it } }.toMap()

    fun verify(env: Map<String, String>) {
        REQUIRED.forEach { if (env[it].isNullOrBlank()) throw StartupCheckException("missing_variable", listOf(it)) }
        // FR-21: a Reply goes out From this address and asks for answers there. Dev and test fall back to a placeholder.
        val profiles = env["SPRING_PROFILES_ACTIVE"].orEmpty().split(',').map { it.trim() }
        if (env["KLEI_MAIL_FROM"].isNullOrBlank() && "dev" !in profiles && "test" !in profiles)
            throw StartupCheckException("missing_variable", listOf("KLEI_MAIL_FROM"))
        try {
            CryptoModule.checkKeys(env, otherSecrets(env))
        } catch (e: KeyRingException) {
            throw StartupCheckException(e.code, e.variables)
        }
    }
}
