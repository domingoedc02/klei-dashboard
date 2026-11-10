package co.klei.app.security

import co.klei.app.web.ClientIp
import co.klei.app.web.ProblemCode
import jakarta.servlet.http.HttpServletRequest
import org.slf4j.LoggerFactory
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.servlet.HandlerMapping

/** One place that turns a refused request into a problem code, shared by the filter chain and the controller advice. */
@Component
class SecurityProblems(private val audit: ForbiddenAudit, private val ips: ClientIp) {
    private val log = LoggerFactory.getLogger(SecurityProblems::class.java)

    fun unauthenticated(req: HttpServletRequest): ProblemCode =
        req.getAttribute(JwtAuthFilter.PROBLEM) as? ProblemCode ?: ProblemCode.UNAUTHENTICATED

    /** Anonymous callers are asked to sign in; signed-in callers lacking the Permission are refused and audited. */
    fun denied(req: HttpServletRequest): ProblemCode {
        val caller = SecurityContextHolder.getContext().authentication?.principal as? Caller ?: return unauthenticated(req)
        // The route pattern, never the raw path, so no request input reaches the Audit Entry.
        val route = req.method + " " + (req.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE) as? String ?: "?")
        runCatching { audit.record(caller, route, ips.of(req)) }
            .onFailure { log.error("forbidden audit failed {}", it.javaClass.name) }
        return ProblemCode.FORBIDDEN
    }
}
