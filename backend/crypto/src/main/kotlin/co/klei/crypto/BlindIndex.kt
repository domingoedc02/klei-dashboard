package co.klei.crypto

import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

/** Canonical form used by every blind index and by [Terms]: NFKC, collapse whitespace, trim, lowercase. */
internal fun canon(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFKC).replace(Regex("\\s+"), " ").trim().lowercase(Locale.ROOT)

/** `HMAC-SHA-256(HKDF(KLEI_BIDX_KEY, "bidx|v1|" + domain), canon(value))`, exact match only (architecture §4.2). */
class BlindIndex internal constructor(private val ring: KeyRing) {
    private val keys = ConcurrentHashMap<BidxDomain, ByteArray>()

    fun of(domain: BidxDomain, value: String): ByteArray =
        Jca.hmac(keys.computeIfAbsent(domain) { Jca.hkdf(ring.bidxKey, "bidx|v1|$it") }, canon(value).toByteArray(Charsets.UTF_8))
}

/** The only tokenizer: split on non letters and digits, canon, drop words over 64 characters, dedupe, cap 32. */
object Terms {
    fun of(text: String): List<String> = text.split(Regex("[^\\p{L}\\p{N}]+"))
        .map(::canon).filter { it.isNotEmpty() && it.length <= 64 }.distinct().take(32)
}

/** UTC `yyyy-MM-dd` buckets (architecture §4.2). */
object DayBucket {
    fun of(at: java.time.Instant): String = at.atZone(java.time.ZoneOffset.UTC).toLocalDate().toString()

    /** Today and the previous n-1 days. */
    fun lastN(n: Int, now: java.time.Instant = java.time.Instant.now()): List<String> =
        (0 until n).map { of(now.minus(java.time.Duration.ofDays(it.toLong()))) }
}
