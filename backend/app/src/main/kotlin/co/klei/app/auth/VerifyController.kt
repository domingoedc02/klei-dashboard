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
import java.util.UUID

/** Model for the A3 page; shared by every place that has to show it (sign-in of an unverified User, invite accepted). */
object VerifyPage {
    const val BAD = "That code is incorrect or has expired."

    fun code(model: Model, email: String, error: String? = null, notice: String? = null, fresh: Boolean = false): String {
        model.addAttribute("mode", "code")
        model.addAttribute("email", email)
        model.addAttribute("error", error)
        model.addAttribute("notice", notice)
        model.addAttribute("fresh", fresh)
        return "verify"
    }
}

/**
 * Auth Web page A3 (email verification). The code path is tied to the browser session that showed the page; the link path
 * carries a 256-bit token in the URL fragment, which fragment.js posts, so it never reaches a log or a Referer header.
 */
@Controller
class VerifyController(private val credentials: CredentialService, private val clientIp: ClientIp) {
    /** With a pending User in the session this is the code page; without one it is the landing for the mailed link. */
    @PermitAll
    @GetMapping("/verify")
    fun page(req: HttpServletRequest, model: Model): String {
        val email = pendingId(req)?.let(credentials::emailOf)
        if (email != null) return VerifyPage.code(model, email)
        model.addAttribute("mode", "link")
        return "verify"
    }

    @PermitAll
    @PostMapping("/verify")
    fun submit(@RequestParam("code", required = false) code: String?, req: HttpServletRequest, res: HttpServletResponse, model: Model): String {
        val id = pendingId(req) ?: return expired(res, model)
        val email = credentials.emailOf(id) ?: return expired(res, model)
        return when (credentials.verifyCode(id, code.orEmpty().trim(), clientIp.of(req))) {
            VerifyResult.OK -> done(req, model)
            else -> { res.status = 400; VerifyPage.code(model, email, VerifyPage.BAD) }
        }
    }

    @PermitAll
    @PostMapping("/verify/link")
    fun link(@RequestParam("token", required = false) token: String?, req: HttpServletRequest, res: HttpServletResponse, model: Model): String {
        if (!credentials.verifyLink(token.orEmpty())) return expired(res, model)
        return done(req, model)
    }

    @PermitAll
    @PostMapping("/verify/resend")
    fun resend(req: HttpServletRequest, res: HttpServletResponse, model: Model): String {
        val id = pendingId(req) ?: return expired(res, model)
        val email = credentials.emailOf(id) ?: return expired(res, model)
        return when (credentials.resend(id)) {
            ResendResult.SENT -> VerifyPage.code(model, email, notice = "A new code is on its way.", fresh = true)
            ResendResult.TOO_SOON -> { res.status = 429; VerifyPage.code(model, email, "Wait a moment before asking for another code.") }
        }
    }

    private fun pendingId(req: HttpServletRequest): UUID? = req.getSession(false)?.getAttribute(USER) as? UUID

    private fun done(req: HttpServletRequest, model: Model): String {
        req.getSession(false)?.invalidate()
        model.addAttribute("mode", "done")
        return "verify"
    }

    private fun expired(res: HttpServletResponse, model: Model): String {
        res.status = 410
        model.addAttribute("mode", "expired")
        return "verify"
    }

    companion object {
        const val USER = "klei.auth.verify-user"
    }
}
