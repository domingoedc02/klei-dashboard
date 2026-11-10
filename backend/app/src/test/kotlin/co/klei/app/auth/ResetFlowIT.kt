package co.klei.app.auth

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMail
import co.klei.app.mail.RecordingMailConfig
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.mail.MailTemplate
import co.klei.core.storage.ObjectStorePort
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.context.annotation.Import
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Story 2.2: forgot password (A4), reset (A5), and what a reset ends. */
@Testcontainers
@Import(RecordingMailConfig::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class ResetFlowIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val OLD = "Old-password-1"
        private const val NEW = "New-password-2"

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            r.add("klei.auth-base-url") { "http://127.0.0.1:$authPort" }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @MockitoBean lateinit var store: ObjectStorePort
    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var mail: RecordingMail
    @Autowired lateinit var credentials: CredentialService
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var limiter: RateLimiter
    @Autowired lateinit var tx: TransactionTemplate

    private val port get() = ctx.webServer!!.port
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:$port")

    @AfterEach fun realClocks() { credentials.clock = Clock.systemUTC(); limiter.clock = Clock.systemUTC() }

    private fun viewerRole() = roles.roles().first { it.name == DefaultRoles.VIEWER }.id

    private fun user(status: UserStatus = UserStatus.ACTIVE): String {
        val email = "rae-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Rae Reset", email, OLD, viewerRole(), status, true) }
        return email
    }

    /** Own client address per call, so the 20-per-address throttle of the real loopback address is not used up. */
    private fun request(email: String) = credentials.requestReset(email, "test-${UUID.randomUUID()}")

    private fun linkOf(email: String) = mail.last(MailTemplate.RESET, email).model.getValue("link")
    private fun token(email: String) = linkOf(email).substringAfter('#')
    private fun audits(action: String) = tx.execute { audit.all().filter { it.action == action } }!!

    private fun open(tok: String): Pair<AuthWebClient, AuthWebClient.Page> {
        val c = client()
        c.get("/reset")
        return c to c.submit("/reset/open", mapOf("token" to tok))
    }

    @Test fun `known and unknown emails get the same page and only a known Active User gets mail`() {
        val known = user()
        val unknown = "nobody-${UUID.randomUUID()}@example.test"
        val invited = user(UserStatus.INVITED)
        val c = client()
        c.get("/forgot")
        val a = c.submit("/forgot", mapOf("email" to known))
        val b = c.submit("/forgot", mapOf("email" to unknown))
        assertEquals(200, a.status)
        assertEquals(200, b.status)
        assertEquals(a.body.replace(known, "X"), b.body.replace(unknown, "X"))
        assertTrue(a.body.contains("<h1>Reset link sent</h1>") && b.body.contains("<h1>Reset link sent</h1>"))
        assertTrue(a.body.contains("If an account exists for") && a.body.contains("you'll get an email in a minute."), a.body)
        assertEquals(1, mail.sent.count { it.to == known })
        assertEquals(0, mail.sent.count { it.to == unknown })
        assertNull(request(invited))
        assertEquals(0, mail.sent.count { it.to == invited })
        assertEquals(setOf("link"), mail.last(MailTemplate.RESET, known).model.keys)
        assertTrue(linkOf(known).startsWith("http://127.0.0.1:$authPort/reset#"))
    }

    @Test fun `reset sets the new password and ends every sign-in`() {
        val email = user()
        val s = client()
        val tokens = s.exchange(s.signIn(email, OLD)).body
        val access = field(tokens, "accessToken")
        val refresh = field(tokens, "refreshToken")
        assertEquals(200, s.api("GET", "/api/v1/me", bearer = access).status)

        request(email)
        val tok = token(email)
        val (c, form) = open(tok)
        assertEquals(200, form.status)
        assertTrue(form.body.contains(email) && form.body.contains("Update password"))
        assertFalse(c.get("/reset").body.contains(tok))

        assertEquals(422, c.submit("/reset", mapOf("token" to tok, "password" to NEW, "confirm" to "other-1234")).status)
        val weak = c.submit("/reset", mapOf("token" to tok, "password" to "short", "confirm" to "short"))
        assertEquals(422, weak.status)
        assertTrue(weak.body.contains("Use at least 8 characters and one number."))

        val done = c.submit("/reset", mapOf("token" to tok, "password" to NEW, "confirm" to NEW))
        assertEquals(200, done.status)
        assertTrue(done.body.contains("Password updated. Sign in."), done.body)

        assertEquals(401, s.api("GET", "/api/v1/me", bearer = access).status)
        assertEquals(401, s.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$refresh"}""").status)
        val fresh = client()
        fresh.authorize()
        assertNull(fresh.login(email, OLD).code())
        assertEquals(200, client().let { it.exchange(it.signIn(email, NEW)) }.status)
        assertEquals(1, audits("password_reset").size)

        // The page ends its own session, so a replay comes from a fresh browser.
        val (again, page) = open(tok)
        assertEquals(410, page.status)
        assertEquals(410, again.submit("/reset", mapOf("token" to tok, "password" to NEW, "confirm" to NEW)).status)
    }

    @Test fun `a new request replaces the old link and an expired link says so`() {
        val email = user()
        request(email)
        val first = token(email)
        request(email)
        val second = token(email)
        assertNotEquals(first, second)
        assertEquals(410, open(first).second.status)
        assertEquals(200, open(second).second.status)

        credentials.clock = Clock.offset(Clock.systemUTC(), Duration.ofMinutes(31))
        val late = open(second).second
        assertEquals(410, late.status)
        assertTrue(late.body.contains("This reset link has expired. Request a new one.") && late.body.contains("/forgot"))
    }

    @Test fun `a link that is not a token is the same expired page`() {
        val (_, page) = open("x".repeat(43))
        assertEquals(410, page.status)
        assertEquals(410, open("").second.status)
    }

    @Test fun `the sixth request for one email is throttled and says when to try again`() {
        val email = user()
        limiter.clock = Clock.offset(Clock.systemUTC(), Duration.ofHours(2))
        repeat(RateLimiter.ACCOUNT_LIMIT) { assertNull(request(email)) }
        val left = request(email)
        assertNotNull(left)
        assertTrue(left > Duration.ZERO)
        assertEquals(RateLimiter.ACCOUNT_LIMIT, mail.sent.count { it.to == email })
    }

    @Test fun `an empty email is refused on the page`() {
        val c = client()
        c.get("/forgot")
        val r = c.submit("/forgot", mapOf("email" to " "))
        assertEquals(422, r.status)
        assertTrue(r.body.contains("Enter your email."))
    }

    /** Feeds infra/ci/axe.mjs. The 'open' landing page is left out: its script posts at once, which a file:// page cannot follow. */
    @Test fun `render A4 and A5 for the accessibility check`() {
        val dir = java.nio.file.Path.of("target", "auth-pages").also(java.nio.file.Files::createDirectories)
        fun save(name: String, p: AuthWebClient.Page) = java.nio.file.Files.writeString(dir.resolve("$name.html"), p.body)
        val email = user()
        val c = client()
        save("a4-form", c.get("/forgot"))
        save("a4-error", c.submit("/forgot", mapOf("email" to " ")))
        save("a4-sent", c.submit("/forgot", mapOf("email" to email)))
        val tok = token(email)
        val r = client()
        r.get("/reset")
        save("a5-form", r.submit("/reset/open", mapOf("token" to tok)))
        save("a5-error", r.submit("/reset", mapOf("token" to tok, "password" to NEW, "confirm" to "other-1234")))
        save("a5-done", r.submit("/reset", mapOf("token" to tok, "password" to NEW, "confirm" to NEW)))
        save("a5-expired", r.submit("/reset/open", mapOf("token" to tok)))
    }
}
