package co.klei.app.web

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component
import org.springframework.web.filter.OncePerRequestFilter

/** AD-1: Auth Web paths exist only on the auth port, everything else only on the API port. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class PortGuardFilter(@Value("\${klei.auth-port}") private val authPort: Int) : OncePerRequestFilter() {

    override fun doFilterInternal(req: HttpServletRequest, res: HttpServletResponse, chain: FilterChain) {
        val path = req.requestURI
        val onAuthPort = req.localPort == authPort
        val authPath = AUTH_PREFIXES.any { path == it || path.startsWith("$it/") }
        val shared = path == "/health" || path.startsWith("/health/")
        if (!shared && authPath != onAuthPort) {
            Problems.write(ProblemCode.NOT_FOUND, req, res)
            return
        }
        chain.doFilter(req, res)
    }

    companion object {
        val AUTH_PREFIXES = listOf("/authorize", "/login", "/invite", "/verify", "/forgot", "/reset", "/return", "/static")
    }
}
