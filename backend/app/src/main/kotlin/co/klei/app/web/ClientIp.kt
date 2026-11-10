package co.klei.app.web

import jakarta.servlet.http.HttpServletRequest
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component

/**
 * The only source of client IP for rate limits and audit (AD-1). Takes the entry `hops` places from the right of
 * `X-Forwarded-For`: those hops are our own proxies, so anything left of them is client-supplied and ignored.
 * No header, or fewer entries than hops, falls back to the TCP peer.
 */
@Component
class ClientIp(@Value("\${KLEI_TRUSTED_PROXY_HOPS:1}") private val hops: Int) {
    fun of(req: HttpServletRequest): String = resolve(req.getHeader("X-Forwarded-For"), req.remoteAddr)

    fun resolve(forwardedFor: String?, peer: String): String {
        val chain = forwardedFor?.split(',')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
        return if (hops < 1 || chain.size < hops) peer else chain[chain.size - hops]
    }
}
