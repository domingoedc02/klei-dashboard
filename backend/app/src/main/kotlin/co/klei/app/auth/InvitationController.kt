package co.klei.app.auth

import jakarta.annotation.security.PermitAll
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam
import co.klei.core.identity.PasswordPolicy

/**
 * Auth Web page A2 (accept an invitation). The invite token lives in the URL fragment, which the server never sees:
 * GET /invite is a landing page whose script posts the fragment to /invite/open, and that response is the real form.
 */
@Controller
class InvitationController(private val credentials: CredentialService) {
    @PermitAll
    @GetMapping("/invite")
    fun landing(model: Model): String {
        model.addAttribute("mode", "open")
        return "invite"
    }

    @PermitAll
    @PostMapping("/invite/open")
    fun open(@RequestParam("token", required = false) token: String?, res: HttpServletResponse, model: Model): String {
        val view = credentials.peekInvite(token.orEmpty()) ?: return expired(res, model)
        return form(model, token.orEmpty(), view, "", null)
    }

    @PermitAll
    @PostMapping("/invite")
    fun accept(
        @RequestParam("token", required = false) tokenIn: String?,
        @RequestParam("name", required = false) nameIn: String?,
        @RequestParam("password", required = false) password: String?,
        @RequestParam("confirm", required = false) confirm: String?,
        req: HttpServletRequest, res: HttpServletResponse, model: Model,
    ): String {
        val token = tokenIn.orEmpty()
        val view = credentials.peekInvite(token) ?: return expired(res, model)
        val name = nameIn.orEmpty().trim().take(MAX_NAME)
        val pw = password.orEmpty()
        val error = when {
            name.isEmpty() -> "Enter your full name."
            pw != confirm.orEmpty() -> "Passwords don't match."
            !PasswordPolicy.accepts(pw) -> "Use at least 8 characters and one number. 128 characters at most."
            else -> null
        }
        if (error != null) {
            res.status = 422
            return form(model, token, view, name, error)
        }
        val id = credentials.accept(token, name, pw) ?: return expired(res, model)
        req.getSession(true).setAttribute(VerifyController.USER, id)
        return VerifyPage.code(model, view.email, fresh = true)
    }

    private fun form(model: Model, token: String, view: InviteView, name: String, error: String?): String {
        model.addAttribute("mode", "form")
        model.addAttribute("token", token)
        model.addAttribute("email", view.email)
        model.addAttribute("inviter", view.inviter)
        model.addAttribute("role", view.role)
        model.addAttribute("name", name)
        model.addAttribute("error", error)
        return "invite"
    }

    private fun expired(res: HttpServletResponse, model: Model): String {
        res.status = 410
        model.addAttribute("mode", "expired")
        return "invite"
    }

    companion object {
        const val MAX_NAME = 100
    }
}
