package co.klei.app.web

import co.klei.app.auth.TwoFactorService
import co.klei.app.auth.TwoFactorSetup
import co.klei.app.auth.TwoFactorStatus
import co.klei.app.security.Caller
import co.klei.app.security.TokenAuthorized
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.CacheControl
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

class TwoFactorCode { var code: String? = null }
class TwoFactorProof { var password: String? = null; var code: String? = null }
data class RecoveryCodes(val codes: List<String>)

/** FR-44: the signed-in User's own second factor. Secrets and codes go out once, never cached, and are never logged. */
@RestController
@RequestMapping("/api/v1/me/2fa")
class TwoFactorController(private val twoFactor: TwoFactorService, private val clientIp: ClientIp) {
    @TokenAuthorized
    @GetMapping
    fun status(@AuthenticationPrincipal caller: Caller): TwoFactorStatus = twoFactor.status(caller.id)

    @TokenAuthorized
    @PostMapping("/start")
    fun start(req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<TwoFactorSetup> =
        once(twoFactor.start(caller.id, clientIp.of(req)))

    @TokenAuthorized
    @PostMapping("/confirm")
    fun confirm(@RequestBody body: TwoFactorCode, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<RecoveryCodes> =
        once(RecoveryCodes(twoFactor.confirm(caller.id, body.code, clientIp.of(req))))

    @TokenAuthorized
    @PostMapping("/disable")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    fun disable(@RequestBody body: TwoFactorProof, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller) =
        twoFactor.disable(caller.id, body.password, body.code, clientIp.of(req))

    /** Replaces all recovery codes. */
    @TokenAuthorized
    @PostMapping("/codes")
    fun codes(@RequestBody body: TwoFactorProof, req: HttpServletRequest, @AuthenticationPrincipal caller: Caller): ResponseEntity<RecoveryCodes> =
        once(RecoveryCodes(twoFactor.newCodes(caller.id, body.password, body.code, clientIp.of(req))))

    private fun <T : Any> once(body: T) = ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body)
}
