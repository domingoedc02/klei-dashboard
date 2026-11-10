package co.klei.app.web

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

/**
 * Assigns the correlation id and writes the only access log line: method, status, duration, id.
 * Path, query and body are never logged (NFR-1).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class CorrelationIdFilter : OncePerRequestFilter() {
    private val access = LoggerFactory.getLogger("klei.access")

    override fun doFilterInternal(req: HttpServletRequest, res: HttpServletResponse, chain: FilterChain) {
        val incoming = req.getHeader(HEADER)
        val id = if (incoming != null && UUID_FORM.matches(incoming)) incoming.lowercase() else UUID.randomUUID().toString()
        req.setAttribute(ATTR, id)
        res.setHeader(HEADER, id)
        MDC.put("correlationId", id)
        val start = System.nanoTime()
        try {
            chain.doFilter(req, res)
        } finally {
            val ms = (System.nanoTime() - start) / 1_000_000
            access.info("method={} status={} durationMs={} correlationId={}", req.method, res.status, ms, id)
            MDC.remove("correlationId")
        }
    }

    companion object {
        const val HEADER = "X-Correlation-Id"
        const val ATTR = "klei.correlationId"
        private val UUID_FORM = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")

        fun of(req: HttpServletRequest): String = req.getAttribute(ATTR) as? String ?: UUID.randomUUID().toString()
    }
}
