package co.klei.app.security

import co.klei.app.web.ProblemCode
import co.klei.core.identity.Permission
import co.klei.crypto.TokenSigner
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import java.util.UUID

/** The signed-in User and Session of a request; nothing else about the User travels with it. */
data class Caller(val id: UUID, val sid: String)

/**
 * Bearer access token to Spring Security authentication (architecture §6.1). Never answers a request itself:
 * a refused token leaves the request anonymous with the reason on a request attribute, so public paths stay public
 * and the entry point writes the one problem+json for protected ones.
 */
class JwtAuthFilter(
    private val tokens: TokenSigner,
    private val sessions: SessionRegistry,
    private val epoch: PermissionEpoch,
) : OncePerRequestFilter() {
    override fun doFilterInternal(req: HttpServletRequest, res: HttpServletResponse, chain: FilterChain) {
        req.getHeader("Authorization")?.let { header ->
            val problem = authenticate(header)
            if (problem != null) req.setAttribute(PROBLEM, problem)
        }
        chain.doFilter(req, res)
    }

    private fun authenticate(header: String): ProblemCode? {
        val token = header.takeIf { it.startsWith("Bearer ", ignoreCase = true) }?.substring(7)?.trim()
        val c = token?.let(tokens::verify) ?: return ProblemCode.UNAUTHENTICATED
        val caller = runCatching { Caller(UUID.fromString(c.sub), c.sid) }.getOrNull() ?: return ProblemCode.UNAUTHENTICATED
        if (c.iat < sessions.startedAt.epochSecond || sessions.isRevoked(c.sid) || c.epoch != epoch.current()) return ProblemCode.TOKEN_STALE
        val authorities = c.perms.filter { p -> Permission.entries.any { it.name == p } }.map(::SimpleGrantedAuthority)
        SecurityContextHolder.getContext().authentication = UsernamePasswordAuthenticationToken.authenticated(caller, null, authorities)
        return null
    }

    companion object {
        const val PROBLEM = "klei.auth.problem"
    }
}
