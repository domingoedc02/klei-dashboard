package co.klei.app.auth

import co.klei.app.web.ClientIp
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.crypto.Pkce
import io.swagger.v3.oas.annotations.security.SecurityRequirements
import jakarta.annotation.security.PermitAll
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

class TokenRequest { var code: String? = null; var verifier: String? = null }
class RefreshRequest { var refreshToken: String? = null }

/**
 * API side of sign-in (architecture §6.1): trade the one-time code for tokens, rotate, sign out. These three need no
 * access token; the code and the refresh token are the credentials.
 */
@RestController
@RequestMapping("/api/v1/auth")
class AuthTokenController(private val codes: AuthCodeStore, private val refresh: RefreshService, private val clientIp: ClientIp) {
    @PermitAll
    @SecurityRequirements
    @PostMapping("/token")
    fun token(@RequestBody body: TokenRequest): ResponseEntity<TokenPair> {
        val code = body.code?.takeIf { it.length <= MAX }
        val verifier = body.verifier?.takeIf { it.length <= MAX }
        if (code == null || verifier == null) throw ProblemException(ProblemCode.BAD_REQUEST)
        // Redeeming first burns the code, so a wrong verifier cannot be retried.
        val entry = codes.redeem(code) ?: throw ProblemException(ProblemCode.BAD_REQUEST)
        if (!Pkce.matches(verifier, entry.challenge)) throw ProblemException(ProblemCode.BAD_REQUEST)
        return fresh(refresh.start(entry.userId, entry.keep) ?: throw ProblemException(ProblemCode.FORBIDDEN))
    }

    @PermitAll
    @SecurityRequirements
    @PostMapping("/refresh")
    fun refresh(@RequestBody body: RefreshRequest, req: HttpServletRequest): ResponseEntity<TokenPair> {
        val presented = body.refreshToken?.takeIf { it.length <= MAX } ?: throw ProblemException(ProblemCode.BAD_REQUEST)
        return fresh(refresh.rotate(presented, clientIp.of(req)) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED))
    }

    @PermitAll
    @SecurityRequirements
    @PostMapping("/logout")
    fun logout(@RequestBody body: RefreshRequest): ResponseEntity<Void> {
        body.refreshToken?.takeIf { it.length <= MAX }?.let(refresh::logout)
        return ResponseEntity.noContent().build()
    }

    private fun fresh(pair: TokenPair) = ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(pair)

    private companion object { const val MAX = 256 }
}
