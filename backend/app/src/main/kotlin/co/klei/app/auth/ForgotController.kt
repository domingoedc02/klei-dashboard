package co.klei.app.auth

import co.klei.app.web.ClientIp
import jakarta.annotation.security.PermitAll
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestParam

/**
 * Auth Web page A4 (forgot password). Every email gets the same page; the mail goes out after the response is decided,
 * so an unknown address cannot be told from a known one by what is shown or how long it takes.
 * shortcut: a failed send is only logged (the mail pool is asynchronous), so "We couldn't send the email" is never shown.
 */
@Controller
class ForgotController(private val credentials: CredentialService, private val clientIp: ClientIp) {
    @PermitAll
    @GetMapping("/forgot")
    fun page(model: Model): String = form(model, "", null)

    @PermitAll
    @PostMapping("/forgot")
    fun send(@RequestParam("email", required = false) emailIn: String?, req: HttpServletRequest, res: HttpServletResponse, model: Model): String {
        val email = emailIn.orEmpty().trim().take(AuthorizeController.MAX_EMAIL)
        if (email.isEmpty()) {
            res.status = 422
            return form(model, email, "Enter your email.")
        }
        val left = credentials.requestReset(email, clientIp.of(req))
        if (left != null) {
            val minutes = maxOf(1L, (left.seconds + 59) / 60)
            res.status = 429
            return form(model, email, "Too many requests. Try again in $minutes ${if (minutes == 1L) "minute" else "minutes"}.")
        }
        model.addAttribute("mode", "sent")
        model.addAttribute("email", email)
        return "forgot"
    }

    private fun form(model: Model, email: String, error: String?): String {
        model.addAttribute("mode", "form")
        model.addAttribute("email", email)
        model.addAttribute("error", error)
        return "forgot"
    }
}
