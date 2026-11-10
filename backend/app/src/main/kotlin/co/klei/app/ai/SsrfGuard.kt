package co.klei.app.ai

import co.klei.core.ai.AiFailure
import co.klei.core.ai.AiProviderException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.net.UnknownHostException

/**
 * AD-12 outbound guard. One check per attempt: HTTPS only, the host is resolved exactly once, every address it resolves
 * to must be public, and the caller connects to the returned [Target.address] and nothing else (so a second DNS answer,
 * a rebinding, never matters). In [dev] mode only, plain HTTP, loopback and private ranges are allowed for a stub provider;
 * link-local and cloud-metadata addresses stay refused.
 */
class SsrfGuard(private val dev: Boolean, private val resolver: (String) -> List<InetAddress> = { InetAddress.getAllByName(it).toList() }) {
    class Target(val uri: URI, val address: InetAddress)

    enum class Range { PUBLIC, LOOPBACK, PRIVATE, BLOCKED }

    fun check(url: String): Target {
        val uri = try { URI(url) } catch (e: Exception) { throw AiProviderException(AiFailure.REFUSED) }
        val scheme = uri.scheme?.lowercase()
        val host = uri.host
        if (host.isNullOrEmpty() || uri.rawUserInfo != null || (scheme != "https" && !(dev && scheme == "http"))) throw AiProviderException(AiFailure.REFUSED)
        val addresses = try { resolver(host.removeSurrounding("[", "]")) } catch (e: UnknownHostException) { throw AiProviderException(AiFailure.UNREACHABLE, retry = true) }
        if (addresses.isEmpty()) throw AiProviderException(AiFailure.UNREACHABLE, retry = true)
        // Every answer must pass: a name that mixes a public and a private address is refused, not half-used.
        if (addresses.any { !allowed(range(it)) }) throw AiProviderException(AiFailure.REFUSED)
        return Target(uri, addresses.first())
    }

    private fun allowed(r: Range) = r == Range.PUBLIC || (dev && (r == Range.LOOPBACK || r == Range.PRIVATE))

    companion object {
        fun range(a: InetAddress): Range {
            val b = a.address
            return when (a) {
                is Inet4Address -> v4(b)
                is Inet6Address -> v6(b)
                else -> Range.BLOCKED
            }
        }

        private fun v4(b: ByteArray): Range {
            val b0 = b[0].toInt() and 0xFF
            val b1 = b[1].toInt() and 0xFF
            val b2 = b[2].toInt() and 0xFF
            return when {
                b0 == 127 -> Range.LOOPBACK
                b0 == 10 || (b0 == 172 && b1 in 16..31) || (b0 == 192 && b1 == 168) -> Range.PRIVATE
                // 0/8, CGNAT 100.64/10, link-local and metadata 169.254/16, 192.0.0/24, benchmarking 198.18/15, multicast and reserved 224/3.
                b0 == 0 || (b0 == 100 && b1 in 64..127) || (b0 == 169 && b1 == 254) || (b0 == 192 && b1 == 0 && b2 == 0) ||
                    (b0 == 198 && b1 in 18..19) || b0 >= 224 -> Range.BLOCKED
                else -> Range.PUBLIC
            }
        }

        private fun v6(b: ByteArray): Range {
            fun at(i: Int) = b[i].toInt() and 0xFF
            if (b.all { it == 0.toByte() }) return Range.BLOCKED
            if (b.take(15).all { it == 0.toByte() } && at(15) == 1) return Range.LOOPBACK
            // An IPv4 address wrapped in IPv6 is judged as the IPv4 address: IPv4-compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16.
            if (b.take(12).all { it == 0.toByte() }) return v4(b.copyOfRange(12, 16))
            if (at(0) == 0x00 && at(1) == 0x64 && at(2) == 0xFF && at(3) == 0x9B && (4..11).all { at(it) == 0 }) return v4(b.copyOfRange(12, 16))
            if (at(0) == 0x20 && at(1) == 0x02) return v4(b.copyOfRange(2, 6))
            return when {
                (at(0) and 0xFE) == 0xFC -> Range.PRIVATE // ULA fc00::/7, includes the AWS metadata address fd00:ec2::254
                else -> if (at(0) == 0xFE || at(0) >= 0xFF) Range.BLOCKED else Range.PUBLIC // fe80::/10 link-local, fec0::/10 site-local, ff00::/8 multicast
            }
        }
    }
}
