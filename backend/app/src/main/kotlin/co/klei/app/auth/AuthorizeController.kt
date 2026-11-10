package co.klei.app.auth

import co.klei.core.audit.AuditAction
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.web.ClientIp
import co.klei.core.identity.UserStatus
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.PasswordHasher
import co.klei.crypto.Pkce
import jakarta.annotation.security.PermitAll
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Controller
import org.springframework.ui.Model
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import java.io.Serializable
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.HexFormat
import java.util.UUID

/** What `/authorize` validated; lives in the short cookie session until the password is right or the flow is abandoned. */
data class AuthFlow(val client: String, val challenge: String, val state: String, val redirect: String) : Serializable

/** Right password, second factor still owed (ADR-19). Single use: it is removed when the code is accepted, and expires after [TwoFactorStep.TTL]. */
data class TwoFactorStep(val userId: UUID, val keep: Boolean, val expires: Instant) : Serializable {
    companion object { val TTL: Duration = Duration.ofMinutes(5) }
}

/**
 * Auth Web pages A1 (sign in) and A6 (return) on the Auth port (architecture §6.1-6.2). The password is checked here and
 * never reaches the desktop app; the app only gets a one-time code to trade for tokens.
 */
@Controller
class AuthorizeController(
    private val users: UserService,
    private val roles: RoleService,
    private val hasher: PasswordHasher,
    private val codes: AuthCodeStore,
    private val limiter: RateLimiter,
    private val audit: AuditService,
    private val bidx: BlindIndex,
    private val clientIp: ClientIp,
    private val credentials: CredentialService,
    private val twoFactor: TwoFactorService,
) {
    internal var clock: Clock = Clock.systemUTC()

    /** Made at boot so an unknown email costs the same Argon2id verify as a known one, the first time too. */
    private val dummyHash = hasher.hash("klei-dummy-password")

    @PermitAll
    @GetMapping("/authorize")
    fun authorize(
        @RequestParam("client", required = false) client: String?,
        @RequestParam("challenge", required = false) challenge: String?,
        @RequestParam("state", required = false) state: String?,
        @RequestParam("redirect", required = false) redirect: String?,
        req: HttpServletRequest, res: HttpServletResponse, model: Model,
    ): String {
        val valid = client == "desktop" && challenge != null && Pkce.validChallenge(challenge) &&
            state != null && STATE.matches(state) && redirect != null && RedirectUri.valid(redirect)
        if (!valid) return bad(res)
        // A fresh id for every flow: nothing from an earlier session carries over.
        req.getSession(false)?.invalidate()
        req.getSession(true).setAttribute(FLOW, AuthFlow(client!!, challenge!!, state!!, redirect!!))
        return form(model, "", false, null)
    }

    @PermitAll
    @PostMapping("/login")
    fun login(
        @RequestParam("email", required = false) emailIn: String?,
        @RequestParam("password", required = false) password: String?,
        @RequestParam("keep", required = false) keepIn: String?,
        req: HttpServletRequest, res: HttpServletResponse, model: Model,
    ): String {
        val session = req.getSession(false)
        val flow = session?.getAttribute(FLOW) as? AuthFlow ?: return bad(res)
        val email = emailIn.orEmpty().trim().take(MAX_EMAIL)
        val keep = keepIn != null
        val key = HexFormat.of().formatHex(bidx.of(BidxDomain.APP_USER_EMAIL, email))
        val ip = clientIp.of(req)

        limiter.retryAfter(key, ip)?.let { left ->
            res.status = 429
            return form(model, email, keep, lockout(left))
        }

        val user = if (email.isEmpty()) null else users.find(email)
        val right = hasher.verify(password.orEmpty(), user?.password ?: dummyHash) && user != null && user.status == UserStatus.ACTIVE
        if (!right) {
            if (limiter.fail(key, ip)) audit.record(AuditAction.SIGN_IN_LOCKED, actorId = user?.id, actorName = user?.name ?: "unknown", ip = ip)
            res.status = 401
            return form(model, email, keep, "Email or password is incorrect. Check both and try again, or reset your password.")
        }

        if (roles.permissions(user!!.roleId).isEmpty()) {
            audit.record(AuditAction.SIGN_IN_NO_ACCESS, actorId = user.id, actorName = user.name, ip = ip)
            res.status = 403
            return form(model, email, keep, "Your account has no access yet. Ask an admin.")
        }

        if (user.verified && twoFactor.required(user.id)) {
            // The failure counter stays until the code is right, so a stolen password cannot guess codes for free.
            session.setAttribute(STEP, TwoFactorStep(user.id, keep, clock.instant().plus(TwoFactorStep.TTL)))
            return codePage(model, false, null)
        }
        limiter.clear(key)
        if (!user.verified) {
            // Right password, unverified mailbox: no auth code. A3 takes over; the session id changes, the CSRF token stays
            // valid for the page rendered below, and the PKCE flow is dropped.
            credentials.issueVerify(user)
            session.removeAttribute(FLOW)
            session.setAttribute(VerifyController.USER, user.id)
            req.changeSessionId()
            return VerifyPage.code(model, user.email, fresh = true)
        }
        val code = codes.issue(user.id, keep, flow.client, flow.redirect, flow.challenge)
        session.invalidate()
        model.addAttribute("done", true)
        model.addAttribute("target", "${flow.redirect}?code=$code&state=${flow.state}")
        return "return"
    }

    @PermitAll
    @GetMapping("/login/code")
    fun codeForm(@RequestParam("recovery", required = false) recovery: String?, req: HttpServletRequest, res: HttpServletResponse, model: Model): String {
        val session = req.getSession(false)
        if (session?.getAttribute(FLOW) !is AuthFlow || session.getAttribute(STEP) !is TwoFactorStep) return bad(res)
        return codePage(model, recovery != null, null)
    }

    @PermitAll
    @PostMapping("/login/code")
    fun code(
        @RequestParam("code", required = false) codeIn: String?,
        @RequestParam("recovery", required = false) recovery: String?,
        req: HttpServletRequest, res: HttpServletResponse, model: Model,
    ): String {
        val session = req.getSession(false)
        val flow = session?.getAttribute(FLOW) as? AuthFlow ?: return bad(res)
        val step = session.getAttribute(STEP) as? TwoFactorStep ?: return bad(res)
        val user = users.get(step.userId)?.takeIf { it.status == UserStatus.ACTIVE }
        if (user == null || step.expires.isBefore(clock.instant())) {
            session.removeAttribute(STEP)
            res.status = 401
            return form(model, "", false, "Your sign-in timed out. Enter your email and password again.")
        }
        val key = HexFormat.of().formatHex(bidx.of(BidxDomain.APP_USER_EMAIL, user.email))
        val ip = clientIp.of(req)
        limiter.retryAfter(key, ip)?.let { left ->
            res.status = 429
            return codePage(model, recovery != null, lockout(left))
        }
        if (!twoFactor.signIn(user, codeIn.orEmpty().take(MAX_CODE), ip)) {
            res.status = 401
            return codePage(model, recovery != null, VerifyPage.BAD)
        }
        val code = codes.issue(user.id, step.keep, flow.client, flow.redirect, flow.challenge)
        session.invalidate()
        model.addAttribute("done", true)
        model.addAttribute("target", "${flow.redirect}?code=$code&state=${flow.state}")
        return "return"
    }

    /** Target of a failed CSRF check (see [AuthWebSecurity]): the flow is stale, so the user starts again from the app. */
    @PermitAll
    @RequestMapping("/login/denied")
    fun denied(res: HttpServletResponse): String = bad(res)

    /** For when the Deep Link did not fire: only focuses the app; it carries no code. */
    @PermitAll
    @GetMapping("/return")
    fun back(@RequestParam("error", required = false) error: String?, model: Model): String {
        if (error != null) return "error"
        model.addAttribute("done", false)
        model.addAttribute("target", RedirectUri.DEEP_LINK)
        return "return"
    }

    private fun form(model: Model, email: String, keep: Boolean, error: String?): String {
        model.addAttribute("email", email)
        model.addAttribute("keep", keep)
        model.addAttribute("error", error)
        return "login"
    }

    private fun codePage(model: Model, recovery: Boolean, error: String?): String {
        model.addAttribute("recovery", recovery)
        model.addAttribute("error", error)
        return "code"
    }

    private fun lockout(left: Duration): String {
        val minutes = maxOf(1L, (left.seconds + 59) / 60)
        return "Too many attempts. Try again in $minutes ${if (minutes == 1L) "minute" else "minutes"}."
    }

    private fun bad(res: HttpServletResponse): String {
        res.status = 400
        return "error"
    }

    companion object {
        const val FLOW = "klei.auth.flow"
        const val STEP = "klei.auth.step"
        const val MAX_EMAIL = 254
        const val MAX_CODE = 32
        private val STATE = Regex("[A-Za-z0-9._~-]{16,128}")
    }
}
