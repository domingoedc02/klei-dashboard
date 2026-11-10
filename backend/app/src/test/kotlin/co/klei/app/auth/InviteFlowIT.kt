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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Story 2.1: invitation (A2), email verification (A3), the admin endpoint and the unverified sign-in branch. */
@Testcontainers
@Import(RecordingMailConfig::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class InviteFlowIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Newcomer-pass-1"

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
    @Autowired lateinit var jdbc: org.springframework.jdbc.core.JdbcTemplate

    private val port get() = ctx.webServer!!.port
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:$port")

    @AfterEach fun realClocks() { credentials.clock = Clock.systemUTC(); limiter.clock = Clock.systemUTC() }

    private fun adminToken(): String {
        val c = client()
        return field(c.exchange(c.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)).body, "accessToken")!!
    }

    private fun viewerRole() = roles.roles().first { it.name == DefaultRoles.VIEWER }.id

    private fun invite(name: String = "Nia Newcomer"): Pair<String, String> {
        val email = "nia-${UUID.randomUUID()}@example.test"
        val c = client()
        val r = c.api("POST", "/api/v1/admin/users", """{"name":"$name","email":"$email","roleId":"${viewerRole()}"}""", adminToken())
        assertEquals(201, r.status, r.body)
        return email to token(mail.last(MailTemplate.INVITE, email).model.getValue("link"))
    }

    private fun token(link: String) = link.substringAfter('#')

    private fun accept(c: AuthWebClient, tok: String, email: String, pw: String = PW): AuthWebClient.Page {
        c.get("/invite")
        assertEquals(200, c.submit("/invite/open", mapOf("token" to tok)).status)
        return c.submit("/invite", mapOf("token" to tok, "name" to "Nia Newcomer", "password" to pw, "confirm" to pw))
    }

    private fun audits(action: String) = tx.execute { audit.all().filter { it.action == action } }!!

    @Test fun `only a caller with the staff permission can invite and an existing email is a conflict`() {
        val c = client()
        val body = """{"name":"Dup","email":"dup@example.test","roleId":"${viewerRole()}"}"""
        assertEquals(401, c.api("POST", "/api/v1/admin/users", body).status)
        val viewerEmail = "v-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Vi Viewer", viewerEmail, PW, viewerRole(), UserStatus.ACTIVE, true) }
        val v = client()
        val vt = field(v.exchange(v.signIn(viewerEmail, PW)).body, "accessToken")
        assertEquals(403, c.api("POST", "/api/v1/admin/users", body, vt).status)
        val t = adminToken()
        assertEquals(201, c.api("POST", "/api/v1/admin/users", body, t).status)
        assertEquals(409, c.api("POST", "/api/v1/admin/users", body, t).status)
        assertEquals(409, c.api("POST", "/api/v1/admin/users", body.replace("dup@", "DUP@"), t).status)
        assertEquals(422, c.api("POST", "/api/v1/admin/users", """{"name":"","email":"x@example.test","roleId":"${viewerRole()}"}""", t).status)
        assertEquals(422, c.api("POST", "/api/v1/admin/users", """{"name":"X","email":"not-an-email","roleId":"${viewerRole()}"}""", t).status)
        assertEquals(422, c.api("POST", "/api/v1/admin/users", """{"name":"X","email":"y@example.test","roleId":"${UUID.randomUUID()}"}""", t).status)
    }

    @Test fun `invite then verify by code then sign in`() {
        val (email, tok) = invite()
        assertEquals(1, mail.sent.count { it.to == email })
        assertTrue(audits("user_invited").isNotEmpty())
        val link = mail.last(MailTemplate.INVITE, email).model.getValue("link")
        assertTrue(link.startsWith("http://127.0.0.1:$authPort/invite#"), link)

        val c = client()
        val landing = c.get("/invite")
        assertEquals(200, landing.status)
        assertFalse(landing.body.contains(tok))
        val form = c.submit("/invite/open", mapOf("token" to tok))
        assertEquals(200, form.status)
        assertTrue(form.body.contains(email) && form.body.contains("Admin") && form.body.contains("Viewer"))
        listOf(
            "Invitation", "<h1>Join Klei Bridal</h1>", "invited you as", "Set by your admin. Cannot be changed.", "At least 8 characters with a number.",
            "Create account", "Already have an account?", "data-busy=\"Creating account…\"",
        ).forEach { assertTrue(form.body.contains(it), it) }
        assertTrue(form.body.contains("readonly"))
        assertFalse(form.body.contains(TestSupport.ADMIN_EMAIL), "the inviter shows by name, never by email")

        assertTrue(c.submit("/invite", mapOf("token" to tok, "name" to "Nia", "password" to PW, "confirm" to "other-1234")).body.contains("Passwords don&#39;t match."))
        assertEquals(422, c.submit("/invite", mapOf("token" to tok, "name" to "Nia", "password" to "short1", "confirm" to "short1")).status)
        assertEquals(422, c.submit("/invite", mapOf("token" to tok, "name" to "Nia", "password" to "nodigitshere", "confirm" to "nodigitshere")).status)
        assertEquals(422, c.submit("/invite", mapOf("token" to tok, "name" to "Nia", "password" to "1" + "a".repeat(128), "confirm" to "1" + "a".repeat(128))).status)

        val verify = c.submit("/invite", mapOf("token" to tok, "name" to "Nia Newcomer", "password" to PW, "confirm" to PW))
        assertEquals(200, verify.status, verify.body)
        assertTrue(verify.body.contains("name=\"code\"") && verify.body.contains(email))
        listOf("Check your email", "autocomplete=\"one-time-code\"", "data-v=\"code\"", "Verify email", "Didn’t get it?", "Resend")
            .forEach { assertTrue(verify.body.contains(it), it) }
        val sent = mail.last(MailTemplate.VERIFY, email)
        assertEquals(setOf("code", "link"), sent.model.keys)

        val used = client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to tok))
        assertEquals(410, used.status)
        assertTrue(used.body.contains("This invite link has expired. Ask your admin to send a new one."))
        assertFalse(used.body.contains("name=\"password\""))

        val wrong = if (sent.model.getValue("code") == "000000") "111111" else "000000"
        val bad = c.submit("/verify", mapOf("code" to wrong))
        assertEquals(400, bad.status)
        assertTrue(bad.body.contains("That code is incorrect or has expired."))
        val ok = c.submit("/verify", mapOf("code" to sent.model.getValue("code")))
        assertEquals(200, ok.status)
        assertTrue(ok.body.contains("Email verified. Open Klei Bridal and sign in."))
        assertEquals(1, audits("email_verified").count { it.actorName == "Nia Newcomer" })

        val s = client()
        assertEquals(200, s.exchange(s.signIn(email, PW)).status)
    }

    @Test fun `an invite without a known inviter says only the role`() {
        val (email, tok) = invite()
        jdbc.update("update auth_credential set invited_by_id = null where user_id = ?", users.find(email)!!.id)
        val c = client()
        c.get("/invite")
        val body = c.submit("/invite/open", mapOf("token" to tok)).body
        assertTrue(body.contains("You were invited as") && body.contains("Viewer") && body.contains(email), body)
        assertFalse(body.contains("invited you as"))
    }

    @Test fun `verify by the mailed link`() {
        val (email, tok) = invite()
        val c = client()
        accept(c, tok, email)
        val link = token(mail.last(MailTemplate.VERIFY, email).model.getValue("link"))
        val l = client()
        l.get("/verify")
        val r = l.submit("/verify/link", mapOf("token" to link))
        assertEquals(200, r.status, r.body)
        assertTrue(r.body.contains("Email verified."))
        val again = client().also { it.get("/verify") }.submit("/verify/link", mapOf("token" to link))
        assertEquals(410, again.status)
    }

    @Test fun `an expired invite or verification is refused`() {
        val (email, tok) = invite()
        credentials.clock = Clock.offset(Clock.systemUTC(), Duration.ofDays(7).plusMinutes(1))
        val c = client()
        c.get("/invite")
        assertEquals(410, c.submit("/invite/open", mapOf("token" to tok)).status)
        credentials.clock = Clock.systemUTC()

        val (email2, tok2) = invite()
        val c2 = client()
        accept(c2, tok2, email2)
        val code = mail.last(MailTemplate.VERIFY, email2).model.getValue("code")
        credentials.clock = Clock.offset(Clock.systemUTC(), Duration.ofMinutes(31))
        val r = c2.submit("/verify", mapOf("code" to code))
        assertEquals(400, r.status)
        assertTrue(r.body.contains("That code is incorrect or has expired."))
        assertNotNull(email)
    }

    @Test fun `five wrong codes lock the credential even for the right code`() {
        val (email, tok) = invite()
        val c = client()
        accept(c, tok, email)
        val code = mail.last(MailTemplate.VERIFY, email).model.getValue("code")
        val wrong = if (code == "000000") "111111" else "000000"
        repeat(5) { assertEquals(400, c.submit("/verify", mapOf("code" to wrong)).status) }
        val r = c.submit("/verify", mapOf("code" to code))
        assertEquals(400, r.status)
        assertTrue(r.body.contains("That code is incorrect or has expired."))
    }

    @Test fun `resend replaces the old code and waits 30 seconds`() {
        val (email, tok) = invite()
        val c = client()
        accept(c, tok, email)
        val first = mail.last(MailTemplate.VERIFY, email).model.getValue("code")
        assertEquals(429, c.submit("/verify/resend", emptyMap()).status)
        credentials.clock = Clock.offset(Clock.systemUTC(), Duration.ofSeconds(31))
        val again = c.submit("/verify/resend", emptyMap())
        assertEquals(200, again.status)
        assertTrue(again.body.contains("A new code is on its way."))
        val second = mail.last(MailTemplate.VERIFY, email).model.getValue("code")
        val oldLink = token(mail.sent.filter { it.template == MailTemplate.VERIFY && it.to == email }.first().model.getValue("link"))
        if (first != second) {
            val r = c.submit("/verify", mapOf("code" to first))
            assertEquals(400, r.status)
        }
        assertEquals(410, client().also { it.get("/verify") }.submit("/verify/link", mapOf("token" to oldLink)).status)
        assertEquals(200, c.submit("/verify", mapOf("code" to second)).status)
    }

    @Test fun `an unverified User signing in gets the code page and no auth code`() {
        val (email, tok) = invite()
        accept(client(), tok, email)
        val before = mail.sent.count { it.template == MailTemplate.VERIFY && it.to == email }
        val c = client()
        c.authorize()
        val r = c.login(email, PW)
        assertEquals(200, r.status, r.body)
        assertNull(r.code())
        assertTrue(r.body.contains("name=\"code\""))
        assertEquals(before + 1, mail.sent.count { it.template == MailTemplate.VERIFY && it.to == email })
        val code = mail.last(MailTemplate.VERIFY, email).model.getValue("code")
        assertTrue(c.submit("/verify", mapOf("code" to code)).body.contains("Email verified."))
        val s = client()
        assertEquals(200, s.exchange(s.signIn(email, PW)).status)
    }

    @Test fun `an Invited User cannot sign in with a guessed password`() {
        val (email, _) = invite()
        val c = client()
        c.authorize()
        assertEquals(401, c.login(email, PW).status)
        assertNull(users.find(email)?.takeIf { it.status == UserStatus.ACTIVE })
        assertEquals(Instant.EPOCH, Instant.EPOCH)
    }

    /** Feeds infra/ci/axe.mjs. The 'open' landing pages are left out: their script posts at once, which a file:// page cannot follow. */
    @Test fun `render A2 and A3 for the accessibility check`() {
        val dir = java.nio.file.Path.of("target", "auth-pages").also(java.nio.file.Files::createDirectories)
        fun save(name: String, p: AuthWebClient.Page) = java.nio.file.Files.writeString(dir.resolve("$name.html"), p.body)
        val (email, tok) = invite()
        val c = client()
        c.get("/invite")
        save("a2-form", c.submit("/invite/open", mapOf("token" to tok)))
        save("a2-error", c.submit("/invite", mapOf("token" to tok, "name" to "Nia", "password" to PW, "confirm" to "other-1234")))
        save("a3-code", c.submit("/invite", mapOf("token" to tok, "name" to "Nia", "password" to PW, "confirm" to PW)))
        save("a3-wrong", c.submit("/verify", mapOf("code" to "000000")))
        save("a2-expired", client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to tok)))
        save("a3-done", c.submit("/verify", mapOf("code" to mail.last(MailTemplate.VERIFY, email).model.getValue("code"))))
        save("a3-expired", client().also { it.get("/verify") }.submit("/verify/link", mapOf("token" to "x")))
    }
}
