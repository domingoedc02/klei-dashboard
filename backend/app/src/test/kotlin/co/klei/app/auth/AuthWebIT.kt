package co.klei.app.auth

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient.Companion.DEEP_LINK
import co.klei.app.auth.AuthWebClient.Companion.STATE
import co.klei.app.auth.AuthWebClient.Companion.VERIFIER
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.AuditService
import co.klei.app.identity.RefreshToken
import co.klei.app.identity.Role
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.storage.ObjectStorePort
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
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

/**
 * Story 1.6: Auth Web sign-in, one-time code, PKCE, token exchange, rotation, logout, throttle and refusals.
 * Failures count against one client IP (20 per 15 min), so this class keeps its wrong-password attempts under that.
 */
@Testcontainers
@SpringBootTest(webEnvironment = RANDOM_PORT)
class AuthWebIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Viewer-pass-1"
        private const val GENERIC = "Email or password is incorrect. Check both and try again, or reset your password."

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @MockitoBean lateinit var store: ObjectStorePort
    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var refresh: RefreshService
    @Autowired lateinit var limiter: RateLimiter
    @Autowired lateinit var em: EntityManager
    @Autowired lateinit var tx: TransactionTemplate

    private val port get() = ctx.webServer!!.port
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:$port")

    @AfterEach fun realClocks() { limiter.clock = Clock.systemUTC(); refresh.clock = Clock.systemUTC() }

    private fun user(status: UserStatus = UserStatus.ACTIVE, roleId: UUID? = null): Pair<UUID, String> {
        val email = "u-${UUID.randomUUID()}@example.test"
        val id = tx.execute {
            val rid = roleId ?: roles.roles().first { it.name == DefaultRoles.VIEWER }.id
            users.create("Una User", email, PW, rid, status, true).id
        }!!
        return id to email
    }

    private fun emptyRole(): UUID = tx.execute { Role(UUID.randomUUID(), "Empty-${UUID.randomUUID()}").also(em::persist).id }!!

    private fun entries(action: String, actor: UUID? = null) =
        tx.execute { audit.all().filter { it.action == action && (actor == null || it.actorId == actor.toString()) } }!!

    private fun tokens(c: AuthWebClient, email: String, keep: Boolean = false): AuthWebClient.Page =
        c.exchange(c.signIn(email, PW, keep = keep)).also { assertEquals(200, it.status, it.body) }

    @Test fun `a bad authorize request is refused with no redirect`() {
        val c = client()
        val ok = c.authorize()
        assertEquals(200, ok.status)
        listOf(
            c.authorize(redirect = "https://evil.test/cb"),
            c.authorize(redirect = "klei://auth/callback/x"),
            c.authorize(redirect = "http://127.0.0.1:80/callback"),
            c.authorize(state = "short"),
            c.authorize(challenge = "tooshort"),
            c.authorize(client = "web"),
            c.get("/authorize"),
        ).forEach {
            assertEquals(400, it.status)
            assertNull(it.header("Location"))
            assertFalse(it.body.contains("name=\"password\""))
        }
        assertEquals(200, c.authorize(redirect = "http://127.0.0.1:53682/callback").status)
    }

    @Test fun `the sign-in page carries the security headers and a locked-down cookie`() {
        val p = client().authorize()
        assertEquals("default-src 'self'; frame-ancestors 'none'", p.header("Content-Security-Policy"))
        assertEquals("no-referrer", p.header("Referrer-Policy"))
        assertTrue(p.header("Cache-Control")!!.contains("no-store"))
        val cookie = p.headers.allValues("Set-Cookie").single { it.startsWith(AuthWebClient.COOKIE + "=") }
        listOf("HttpOnly", "Secure", "SameSite=Lax", "Path=/").forEach { assertTrue(cookie.contains(it), cookie) }
        assertFalse(cookie.contains("Domain", ignoreCase = true), cookie)
        assertTrue(p.body.contains("name=\"email\"") && p.body.contains("name=\"password\"") && p.body.contains("name=\"_csrf\""))
    }

    @Test fun `the sign-in page reads like the prototype and works without script`() {
        val b = client().authorize().body
        listOf(
            "<h1>Welcome back</h1>", "Sign in to manage gowns and inquiries.", "Work email", "placeholder=\"you@kleibridal.com\"",
            "data-toggle=\"password\"", "Keep me signed in", "Forgot password?", "data-busy=\"Signing in…\"", "src=\"/static/auth.js\"",
        ).forEach { assertTrue(b.contains(it), it) }
        assertTrue(b.contains("<form method=\"post\"") && !b.contains("<script>"), "plain post, no inline script (CSP)")
        assertTrue(b.contains("id=\"e-email\"") && b.contains("aria-describedby=\"e-email\""))
    }

    @Test fun `sign in, trade the code, call the API`() {
        val c = client()
        c.authorize()
        val done = c.login(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
        assertEquals(200, done.status)
        assertTrue(done.target()!!.startsWith("$DEEP_LINK?code="), done.target())
        assertTrue(done.target()!!.endsWith("&state=$STATE"))
        assertTrue(done.body.contains("Open Klei Bridal"))
        assertFalse(done.body.contains(TestSupport.ADMIN_PASSWORD))
        val t = c.exchange(done.code()!!)
        assertEquals(200, t.status, t.body)
        assertTrue(t.header("Cache-Control")!!.contains("no-store"))
        assertTrue(t.body.contains("\"expiresIn\":900"), t.body)
        val me = c.api("GET", "/api/v1/me", bearer = field(t.body, "accessToken"))
        assertEquals(200, me.status, me.body)
        assertTrue(me.body.contains(TestSupport.ADMIN_EMAIL))
    }

    @Test fun `a wrong password and an unknown email look the same and keep only the email`() {
        val (_, email) = user()
        val c = client()
        c.authorize()
        val wrong = c.login(email, "not-the-password")
        val unknown = c.login("nobody-${UUID.randomUUID()}@example.test", "not-the-password")
        assertEquals(401, wrong.status)
        assertEquals(401, unknown.status)
        listOf(wrong, unknown).forEach {
            assertTrue(it.body.contains(GENERIC))
            assertFalse(it.body.contains("not-the-password"))
            assertNull(it.code())
        }
        assertTrue(wrong.body.contains("value=\"$email\""))
        assertFalse(wrong.body.contains("name=\"password\" value=\""))
    }

    @Test fun `a finished sign-in leaves nothing behind so the next visit asks for the password again`() {
        val (_, email) = user()
        val c = client()
        tokens(c, email)
        assertEquals(200, c.authorize().status)
        val again = c.login(email, "")
        assertEquals(401, again.status)
    }

    @Test fun `five failures lock the account, the lock ends, and it is audited`() {
        val (id, email) = user()
        val clock = TestClock(Instant.now())
        limiter.clock = clock
        val c = client()
        c.authorize()
        repeat(5) { assertEquals(401, c.login(email, "wrong-$it").status) }
        val locked = c.login(email, PW)
        assertEquals(429, locked.status)
        assertTrue(locked.body.contains("Too many attempts. Try again in 1 minute."), locked.body)
        assertNull(locked.code())
        assertEquals(1, entries("sign_in_locked", id).size)
        clock.advance(Duration.ofSeconds(61))
        assertNotNull(c.login(email, PW).code())
    }

    @Test fun `an invited user cannot sign in even with the right password`() {
        val (_, email) = user(UserStatus.INVITED)
        val c = client()
        c.authorize()
        val r = c.login(email, PW)
        assertEquals(401, r.status)
        assertTrue(r.body.contains(GENERIC))
    }

    @Test fun `a user whose Role holds no Permission gets no session, and is told only after the right password`() {
        val (id, email) = user(roleId = emptyRole())
        val c = client()
        c.authorize()
        val wrong = c.login(email, "not-the-password")
        assertEquals(401, wrong.status)
        assertTrue(wrong.body.contains(GENERIC))
        val r = c.login(email, PW)
        assertEquals(403, r.status)
        assertTrue(r.body.contains("Your account has no access yet. Ask an admin."))
        assertNull(r.code())
        assertEquals(1, entries("sign_in_no_access", id).size)
        assertNull(tx.execute { refresh.start(id, false) })
    }

    @Test fun `a missing CSRF token is refused`() {
        val c = client()
        c.authorize()
        val r = c.login(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD, token = null)
        assertEquals(400, r.status)
        assertNull(r.code())
        assertFalse(r.body.contains("name=\"password\""))
    }

    @Test fun `posting without an authorize first is refused`() {
        val r = client().post("/login", mapOf("email" to TestSupport.ADMIN_EMAIL, "password" to TestSupport.ADMIN_PASSWORD))
        assertEquals(400, r.status)
        assertNull(r.code())
    }

    @Test fun `the code works once and only with the matching verifier`() {
        val (_, email) = user()
        val c = client()
        val code = c.signIn(email, PW)
        val other = "A".repeat(43)
        assertEquals(400, c.exchange(code, other).status)
        assertEquals(400, c.exchange(code).status)
        val code2 = client().signIn(email, PW)
        assertEquals(200, c.exchange(code2).status)
        assertEquals(400, c.exchange(code2).status)
        assertEquals(400, c.exchange("x".repeat(43)).status)
        assertEquals(400, c.api("POST", "/api/v1/auth/token", "{}").status)
    }

    @Test fun `the code expires after 60 seconds`() {
        val (_, email) = user()
        val c = client()
        val codes = ctx.getBean(AuthCodeStore::class.java)
        val clock = TestClock(Instant.now())
        codes.clock = clock
        try {
            val code = c.signIn(email, PW)
            clock.advance(Duration.ofSeconds(61))
            assertEquals(400, c.exchange(code).status)
        } finally { codes.clock = Clock.systemUTC() }
    }

    @Test fun `rotation, the 10 second grace, and reuse revoking the family`() {
        val (id, email) = user()
        val clock = TestClock(Instant.now())
        refresh.clock = clock
        val c = client()
        val first = tokens(c, email)
        val access0 = field(first.body, "accessToken")!!
        val r0 = field(first.body, "refreshToken")!!
        assertEquals(200, c.api("GET", "/api/v1/me", bearer = access0).status)

        val second = c.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$r0"}""")
        assertEquals(200, second.status, second.body)
        val r1 = field(second.body, "refreshToken")!!
        assertNotEquals(r0, r1)

        val raced = c.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$r0"}""")
        assertEquals(200, raced.status)
        assertEquals(r1, field(raced.body, "refreshToken"))

        clock.advance(Duration.ofSeconds(11))
        assertEquals(401, c.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$r0"}""").status)
        assertEquals(1, entries("refresh_reuse", id).size)
        assertEquals(401, c.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$r1"}""").status)
        assertEquals(401, c.api("GET", "/api/v1/me", bearer = access0).status)
    }

    @Test fun `unknown and malformed refresh tokens are unauthenticated`() {
        val c = client()
        assertEquals(401, c.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"${"a".repeat(43)}"}""").status)
        assertEquals(401, c.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"short"}""").status)
        assertEquals(400, c.api("POST", "/api/v1/auth/refresh", "{}").status)
    }

    @Test fun `logout ends the family and the access token with it`() {
        val (_, email) = user()
        val c = client()
        val t = tokens(c, email)
        val access = field(t.body, "accessToken")!!
        val r = field(t.body, "refreshToken")!!
        assertEquals(204, c.api("POST", "/api/v1/auth/logout", """{"refreshToken":"$r"}""").status)
        assertEquals(401, c.api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$r"}""").status)
        assertEquals(401, c.api("GET", "/api/v1/me", bearer = access).status)
        assertEquals(204, c.api("POST", "/api/v1/auth/logout", """{"refreshToken":"$r"}""").status)
        assertEquals(204, c.api("POST", "/api/v1/auth/logout", "{}").status)
    }

    @Test fun `keep me signed in lasts 30 days, otherwise 24 hours`() {
        fun expiry(userId: UUID) = tx.execute {
            em.createQuery("select t from RefreshToken t where t.userId = :u", RefreshToken::class.java).setParameter("u", userId).resultList.single().expiresAt
        }!!
        val (shortId, shortEmail) = user()
        val (keepId, keepEmail) = user()
        tokens(client(), shortEmail)
        tokens(client(), keepEmail, keep = true)
        val now = Instant.now()
        assertTrue(Duration.between(now, expiry(shortId)) in Duration.ofHours(23)..Duration.ofHours(24))
        assertTrue(Duration.between(now, expiry(keepId)) in Duration.ofDays(29)..Duration.ofDays(30))
    }

    @Test fun `refresh is refused once the user is no longer active or loses every Permission`() {
        val (a, emailA) = user()
        val (b, emailB) = user()
        val ra = field(tokens(client(), emailA).body, "refreshToken")!!
        val rb = field(tokens(client(), emailB).body, "refreshToken")!!
        tx.execute { users.get(a)!!.status = UserStatus.INVITED }
        tx.execute { users.get(b)!!.roleId = emptyRole() }
        assertEquals(401, client().api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$ra"}""").status)
        assertEquals(403, client().api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$rb"}""").status)
        assertEquals(401, client().api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$rb"}""").status)
    }

    @Test fun `each port serves only its own paths`() {
        val c = client()
        val api = "http://127.0.0.1:$port"
        val onApi = java.net.http.HttpClient.newHttpClient().send(
            java.net.http.HttpRequest.newBuilder(java.net.URI.create("$api/authorize?client=desktop")).build(),
            java.net.http.HttpResponse.BodyHandlers.ofString(),
        )
        assertEquals(404, onApi.statusCode())
        assertEquals(404, c.get("/api/v1/me").status)
        assertEquals(404, c.get("/api/v1/auth/token").status)
        assertEquals(200, c.get("/health").status)
        assertEquals(200, c.get("/static/auth.css").status)
    }

    @Test fun `the return page without a code only focuses the app`() {
        val p = client().get("/return")
        assertEquals(200, p.status)
        assertFalse(p.body.contains("code="))
        assertTrue(p.body.contains(DEEP_LINK))
        assertTrue(client().get("/return?error=1").body.contains("name=\"email\"").not())
    }

    /** The axe-core check (infra/ci/axe.mjs) reads these renderings; they hold no secret, only the forms and a dummy email. */
    @Test fun `render the pages for the accessibility check`() {
        val dir = java.nio.file.Path.of("target", "auth-pages").also(java.nio.file.Files::createDirectories)
        val c = client()
        fun save(name: String, p: AuthWebClient.Page) = java.nio.file.Files.writeString(dir.resolve("$name.html"), p.body)
        save("a1-sign-in", c.authorize())
        save("a1-error", c.login("someone@example.test", "not-the-password"))
        val (_, email) = user()
        save("a6-signed-in", client().also { it.authorize() }.login(email, PW))
        save("a6-return", client().get("/return"))
        save("error", client().get("/return?error=1"))
        assertTrue(java.nio.file.Files.list(dir).use { it.count() } >= 5)
    }
}
