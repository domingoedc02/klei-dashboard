package co.klei.app.auth

import co.klei.app.web.ClientIp
import co.klei.core.identity.PasswordPolicy
import jakarta.annotation.security.PermitAll
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam

/**
 * Auth Web page A5 (choose a new password). Same shape as A2: the token rides in the URL fragment, GET /reset is a landing
 * page whose script posts it to /reset/open, and that response is the form.
 * shortcut: after a reset the page says "Password updated. Sign in." with no link into the sign-in form, because A1 only exists
 * inside a PKCE flow started by the app; add a Deep Link back to the app with the other Deep Link work.
 */
@Controller
class ResetController(private val credentials: CredentialService, private val clientIp: ClientIp) {
    @PermitAll
    @GetMapping("/reset")
    fun landing(model: Model): String {
        model.addAttribute("mode", "open")
        return "reset"
    }

    @PermitAll
    @PostMapping("/reset/open")
    fun open(@RequestParam("token", required = false) token: String?, res: HttpServletResponse, model: Model): String {
        val email = credentials.peekReset(token.orEmpty()) ?: return expired(res, model)
        return form(model, token.orEmpty(), email, null)
    }

    @PermitAll
    @PostMapping("/reset")
    fun update(
        @RequestParam("token", required = false) tokenIn: String?,
        @RequestParam("password", required = false) password: String?,
        @RequestParam("confirm", required = false) confirm: String?,
        req: HttpServletRequest, res: HttpServletResponse, model: Model,
    ): String {
        val token = tokenIn.orEmpty()
        val email = credentials.peekReset(token) ?: return expired(res, model)
        val pw = password.orEmpty()
        val error = when {
            pw != confirm.orEmpty() -> "Passwords don't match."
            !PasswordPolicy.accepts(pw) -> "Use at least 8 characters and one number. 128 characters at most."
            else -> null
        }
        if (error != null) {
            res.status = 422
            return form(model, token, email, error)
        }
        if (!credentials.reset(token, pw, clientIp.of(req))) return expired(res, model)
        req.getSession(false)?.invalidate()
        model.addAttribute("mode", "done")
        return "reset"
    }

    private fun form(model: Model, token: String, email: String, error: String?): String {
        model.addAttribute("mode", "form")
        model.addAttribute("token", token)
        model.addAttribute("email", email)
        model.addAttribute("error", error)
        return "reset"
    }

    private fun expired(res: HttpServletResponse, model: Model): String {
        res.status = 410
        model.addAttribute("mode", "expired")
        return "reset"
    }
}
