package co.klei.crypto

import java.util.Base64
import java.util.UUID

fun testKey(seed: Int): String = Base64.getEncoder().encodeToString(ByteArray(32) { (it + seed * 7).toByte() })

fun testEnv(active: Int = 1, keks: Int = 1): Map<String, String> =
    (1..keks).associate { "KLEI_KEK_$it" to testKey(it) } +
        mapOf("KLEI_KEK_ACTIVE" to active.toString(), "KLEI_BIDX_KEY" to testKey(50), "KLEI_JWT_KEY" to testKey(60))

internal class FixedDeks(private val deks: List<Dek> = listOf(Dek(UUID.randomUUID(), ByteArray(32) { it.toByte() }))) : Deks {
    override fun active() = deks.last()
    override fun byId(id: UUID) = deks.firstOrNull { it.id == id } ?: throw CryptoException("unknown_dek")
}
