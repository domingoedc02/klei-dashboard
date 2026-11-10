package co.klei.crypto

import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.util.Base64
import java.util.concurrent.Semaphore
import java.util.concurrent.atomic.AtomicInteger

/**
 * Argon2id, PHC string (architecture §6.1). Parameters live in the string, so [verify] honours old hashes.
 * At most [permits] hashes run at once: each needs [memoryKb] of heap.
 */
class PasswordHasher(private val memoryKb: Int = 65536, private val iterations: Int = 3, permits: Int = 2) {
    private val gate = Semaphore(permits, true)
    private val running = AtomicInteger()
    internal val peak = AtomicInteger()
    private val b64 = Base64.getEncoder().withoutPadding()

    fun hash(password: String): String {
        if (password.length > MAX_LENGTH) throw CryptoException("password_too_long")
        val salt = Jca.random(16)
        return "\$argon2id\$v=19\$m=$memoryKb,t=$iterations,p=1\$${b64.encodeToString(salt)}\$${b64.encodeToString(run(password, salt, memoryKb, iterations))}"
    }

    /** False for a wrong password, an over-long one or a string that is not one of our PHC hashes. */
    fun verify(password: String, phc: String): Boolean {
        if (password.length > MAX_LENGTH) return false
        val m = PHC.matchEntire(phc) ?: return false
        val (mem, t, salt, want) = m.destructured
        val dec = Base64.getDecoder()
        return Jca.constantTimeEquals(run(password, dec.decode(salt), mem.toInt(), t.toInt()), dec.decode(want))
    }

    private fun run(password: String, salt: ByteArray, mem: Int, t: Int): ByteArray {
        gate.acquire()
        try {
            peak.accumulateAndGet(running.incrementAndGet(), ::maxOf)
            val g = Argon2BytesGenerator().apply {
                init(Argon2Parameters.Builder(Argon2Parameters.ARGON2_id).withVersion(Argon2Parameters.ARGON2_VERSION_13)
                    .withMemoryAsKB(mem).withIterations(t).withParallelism(1).withSalt(salt).build())
            }
            return ByteArray(32).also { g.generateBytes(password.toByteArray(Charsets.UTF_8), it) }
        } finally {
            running.decrementAndGet()
            gate.release()
        }
    }

    companion object {
        const val MAX_LENGTH = 128
        private val PHC = Regex("""\${'$'}argon2id\${'$'}v=19\${'$'}m=(\d+),t=(\d+),p=1\${'$'}([A-Za-z0-9+/]+)\${'$'}([A-Za-z0-9+/]+)""")
    }
}
