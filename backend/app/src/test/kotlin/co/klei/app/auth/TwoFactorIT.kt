package co.klei.app.auth

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.storage.ObjectStorePort
import co.klei.crypto.Totp
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
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Story 11.14 (FR-44, ADR-19): enrol, the second Auth Web page, replay, recovery codes, lockout, turn off, Admin reset, audit.
 * Each test runs on its own fixed clock (an hour apart), so one test's failures have left the 15-minute window before the next starts.
 */
@Testcontainers
@SpringBootTest(webEnvironment = RANDOM_PORT)
class TwoFactorIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Viewer-pass-1"
        private const val BAD = "That code is incorrect or has expired."
        private val hour = AtomicInteger()

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
    @Autowired lateinit var limiter: RateLimiter
    @Autowired lateinit var twoFactor: TwoFactorService
    @Autowired lateinit var authorize: AuthorizeController
    @Autowired lateinit var tx: TransactionTemplate

    private val clock = TestClock(Instant.now())
    private val port get() = ctx.webServer!!.port
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:$port")

    private fun useClock() {
        clock.now = Instant.now().plus(Duration.ofHours(hour.incrementAndGet().toLong()))
        limiter.clock = clock; twoFactor.clock = clock; authorize.clock = clock
    }

    @AfterEach fun realClocks() { limiter.clock = Clock.systemUTC(); twoFactor.clock = Clock.systemUTC(); authorize.clock = Clock.systemUTC() }

    private class Enrolled(val id: UUID, val email: String, val token: String, val secret: String, val recovery: List<String>)

    private fun newUser(role: String = DefaultRoles.VIEWER): Pair<UUID, String> {
        val email = "tf-${UUID.randomUUID()}@example.test"
        return tx.execute { users.create("Tess Factor", email, PW, roles.roles().first { it.name == role }.id, UserStatus.ACTIVE, true).id }!! to email
    }

    private fun token(c: AuthWebClient, email: String, password: String = PW) = field(c.exchange(c.signIn(email, password)).body, "accessToken")!!

    private fun enrol(): Enrolled {
        useClock()
        val (id, email) = newUser()
        val c = client()
        val token = token(c, email)
        val start = c.api("POST", "/api/v1/me/2fa/start", null, token)
        assertEquals(200, start.status, start.body)
        val secret = field(start.body, "secret")!!
        val confirm = c.api("POST", "/api/v1/me/2fa/confirm", """{"code":"${Totp.code(secret, step())}"}""", token)
        assertEquals(200, confirm.status, confirm.body)
        val recovery = Regex("\"([A-Z2-7]{5}-[A-Z2-7]{5})\"").findAll(confirm.body).map { it.groupValues[1] }.toList()
        return Enrolled(id, email, token, secret, recovery)
    }

    private fun step() = Totp.stepAt(clock.instant().epochSecond)

    /** A code newer than any used so far: moves the clock on one step. */
    private fun next(e: Enrolled): String { clock.advance(Duration.ofSeconds(30)); return Totp.code(e.secret, step()) }

    /** New browser session: password step, then [code]. */
    private fun second(e: Enrolled, code: String, recovery: Boolean = false): AuthWebClient.Page {
        val c = client()
        c.authorize()
        val first = c.login(e.email, PW)
        assertNull(first.code(), "no authorisation code before the second step")
        assertTrue(first.body.contains("Enter your code"), first.body)
        return c.submit("/login/code", buildMap { put("code", code); if (recovery) put("recovery", "1") })
    }

    private fun entries(action: String, actor: UUID) = tx.execute { audit.all().filter { it.action == action && it.actorId == actor.toString() } }!!

    @Test fun `set up needs a right code, shows the secret once and writes the audit entry`() {
        useClock()
        val (id, email) = newUser()
        val c = client()
        val token = token(c, email)
        assertEquals("""{"enabled":false,"recoveryLeft":0,"reset":false}""", c.api("GET", "/api/v1/me/2fa", null, token).body)

        val start = c.api("POST", "/api/v1/me/2fa/start", null, token)
        assertEquals(200, start.status)
        assertTrue(start.header("Cache-Control")!!.contains("no-store"))
        val secret = field(start.body, "secret")!!
        assertTrue(Regex("[A-Z2-7]{32}").matches(secret))
        assertTrue(field(start.body, "uri")!!.startsWith("otpauth://totp/Klei%20Bridal:"), start.body)
        assertTrue(start.body.contains("secret=$secret") && start.body.contains("issuer=Klei%20Bridal"))
        assertTrue(field(start.body, "qr")!!.startsWith("data:image/svg+xml;base64,"))

        val wrong = c.api("POST", "/api/v1/me/2fa/confirm", """{"code":"000000"}""", token)
        assertEquals(422, wrong.status)
        assertFalse(wrong.body.contains(secret))
        assertEquals(false, twoFactor.required(id))
        assertTrue(entries("twofa_enabled", id).isEmpty())

        val again = c.api("POST", "/api/v1/me/2fa/start", null, token)
        val secret2 = field(again.body, "secret")!!
        assertNotEquals(secret, secret2, "a pending secret is replaced")
        assertEquals(422, c.api("POST", "/api/v1/me/2fa/confirm", """{"code":"${Totp.code(secret, step())}"}""", token).status, "the replaced secret no longer works")

        val ok = c.api("POST", "/api/v1/me/2fa/confirm", """{"code":"${Totp.code(secret2, step())}"}""", token)
        assertEquals(200, ok.status)
        val codes = Regex("\"([A-Z2-7]{5}-[A-Z2-7]{5})\"").findAll(ok.body).map { it.groupValues[1] }.toList()
        assertEquals(8, codes.size)
        assertEquals(8, codes.toSet().size)
        assertEquals("""{"enabled":true,"recoveryLeft":8,"reset":false}""", c.api("GET", "/api/v1/me/2fa", null, token).body)
        assertEquals(1, entries("twofa_enabled", id).size)
        assertFalse(entries("twofa_enabled", id).single().detail.orEmpty().contains(secret2))
        assertEquals(409, c.api("POST", "/api/v1/me/2fa/start", null, token).status, "an active secret is not replaced")
        assertEquals(401, c.api("POST", "/api/v1/me/2fa/start").status)
    }

    @Test fun `a user with two-factor gets no authorisation code until the second page accepts a code`() {
        val e = enrol()
        val c = client()
        c.authorize()
        val first = c.login(e.email, PW)
        assertEquals(200, first.status)
        assertNull(first.code())
        assertFalse(first.body.contains("code="), "nothing that looks like an authorisation code")
        assertTrue(first.body.contains("<h1>Enter your code</h1>") && first.body.contains("Use a recovery code") && first.body.contains("name=\"_csrf\""))
        val done = c.submit("/login/code", mapOf("code" to next(e)))
        val code = assertNotNull(done.code())
        assertEquals(200, c.exchange(code).status)
    }

    @Test fun `the second page is unreachable without the password step and the step is single use`() {
        val e = enrol()
        assertEquals(400, client().get("/login/code").status)
        assertEquals(400, client().also { it.authorize() }.get("/login/code").status)
        val c = client()
        c.authorize()
        c.login(e.email, PW)
        assertNotNull(c.submit("/login/code", mapOf("code" to next(e))).code())
        assertEquals(400, c.submit("/login/code", mapOf("code" to next(e))).status, "the session ended with the first success")
    }

    @Test fun `a wrong, reused or out-of-window code is refused with the same wording and audited without the code`() {
        val e = enrol()
        val used = next(e)
        assertNotNull(second(e, used).code())
        val replay = second(e, used)
        assertEquals(401, replay.status)
        assertTrue(replay.body.contains(BAD))
        assertNull(replay.code())
        val away = Totp.code(e.secret, step() + 2)
        assertEquals(401, second(e, away).status)
        assertEquals(401, second(e, "000000").status)
        val failed = entries("sign_in_twofa_failed", e.id)
        assertEquals(3, failed.size)
        failed.forEach { f -> listOf(used, away, "000000").forEach { assertFalse(f.detail.orEmpty().contains(it)) } }
    }

    @Test fun `the previous, current and next step are accepted once each`() {
        val e = enrol()
        clock.advance(Duration.ofSeconds(60))
        val now = step()
        assertNotNull(second(e, Totp.code(e.secret, now - 1)).code(), "previous")
        assertEquals(401, second(e, Totp.code(e.secret, now - 1)).status, "previous again")
        assertNotNull(second(e, Totp.code(e.secret, now)).code(), "current")
        assertNotNull(second(e, Totp.code(e.secret, now + 1)).code(), "next")
        assertEquals(401, second(e, Totp.code(e.secret, now + 1)).status, "next again")
    }

    @Test fun `a recovery code works once, the count drops, and new codes replace them all`() {
        val e = enrol()
        val c = client()
        val first = e.recovery[0]
        assertNotNull(second(e, first, recovery = true).code())
        assertEquals(401, second(e, first, recovery = true).status, "used once")
        assertEquals(7, field(c.api("GET", "/api/v1/me/2fa", null, e.token).body.replace("recoveryLeft\":", "recoveryLeft\":\"").replace(",\"reset", "\",\"reset"), "recoveryLeft")!!.toInt())
        assertNotNull(second(e, e.recovery[1].replace("-", "").lowercase(), recovery = true).code(), "spaces, dashes and case do not matter")

        val bad = c.api("POST", "/api/v1/me/2fa/codes", """{"password":"nope","code":"${next(e)}"}""", e.token)
        assertEquals(422, bad.status)
        val fresh = c.api("POST", "/api/v1/me/2fa/codes", """{"password":"$PW","code":"${next(e)}"}""", e.token)
        assertEquals(200, fresh.status)
        val newCodes = Regex("\"([A-Z2-7]{5}-[A-Z2-7]{5})\"").findAll(fresh.body).map { it.groupValues[1] }.toList()
        assertEquals(8, newCodes.size)
        assertTrue(newCodes.none { it in e.recovery })
        assertEquals(401, second(e, e.recovery[2], recovery = true).status, "an old code no longer works")
        assertNotNull(second(e, newCodes[0], recovery = true).code())
    }

    @Test fun `wrong codes and wrong passwords share one counter, and a lockout shows the existing copy`() {
        val e = enrol()
        val c = client()
        c.authorize()
        repeat(3) { assertEquals(401, c.login(e.email, "wrong-$it").status) }
        assertNull(c.login(e.email, PW).code())
        repeat(2) { assertEquals(401, c.submit("/login/code", mapOf("code" to "00000$it")).status) }
        val locked = c.submit("/login/code", mapOf("code" to next(e)))
        assertEquals(429, locked.status, "the right code is refused while locked")
        assertTrue(locked.body.contains("Too many attempts. Try again in 1 minute."), locked.body)
        assertNull(locked.code())
        assertEquals(1, entries("sign_in_locked", e.id).size)
        clock.advance(Duration.ofSeconds(61))
        assertNotNull(c.submit("/login/code", mapOf("code" to next(e))).code())
    }

    @Test fun `a password step left for five minutes has to be done again`() {
        val e = enrol()
        val c = client()
        c.authorize()
        c.login(e.email, PW)
        clock.advance(Duration.ofMinutes(5).plusSeconds(1))
        val late = c.submit("/login/code", mapOf("code" to next(e)))
        assertEquals(401, late.status)
        assertNull(late.code())
        assertTrue(late.body.contains("name=\"password\""))
    }

    @Test fun `turning it off needs the password and a valid code, clears everything and is audited`() {
        val e = enrol()
        val c = client()
        assertEquals(422, c.api("POST", "/api/v1/me/2fa/disable", """{"password":"nope","code":"${next(e)}"}""", e.token).status)
        assertEquals(422, c.api("POST", "/api/v1/me/2fa/disable", """{"password":"$PW","code":"000000"}""", e.token).status)
        assertTrue(twoFactor.required(e.id))
        assertEquals(204, c.api("POST", "/api/v1/me/2fa/disable", """{"password":"$PW","code":"${next(e)}"}""", e.token).status)
        assertFalse(twoFactor.required(e.id))
        assertEquals(1, entries("twofa_disabled", e.id).size)
        assertEquals("""{"enabled":false,"recoveryLeft":0,"reset":false}""", c.api("GET", "/api/v1/me/2fa", null, e.token).body)
        val plain = client()
        plain.authorize()
        assertNotNull(plain.login(e.email, PW).code(), "the password alone signs in again")
        assertEquals(409, c.api("POST", "/api/v1/me/2fa/disable", """{"password":"$PW","code":"000000"}""", e.token).status)
    }

    @Test fun `an Admin can reset another user, with the permission and an audit entry, and the user sees a banner`() {
        val e = enrol()
        val c = client()
        val admin = token(c, TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
        val adminId = tx.execute { users.find(TestSupport.ADMIN_EMAIL)!!.id }!!
        val viewer = token(client(), newUser().second)
        assertEquals(403, c.api("POST", "/api/v1/admin/users/${e.id}/2fa/reset", null, viewer).status)
        assertTrue(twoFactor.required(e.id))

        assertTrue(c.api("GET", "/api/v1/admin/users", null, admin).body.contains("\"id\":\"${e.id}\"") )
        assertEquals(204, c.api("POST", "/api/v1/admin/users/${e.id}/2fa/reset", null, admin).status)
        assertFalse(twoFactor.required(e.id))
        val log = entries("twofa_reset", adminId).single()
        assertEquals("Tess Factor", log.detail)
        assertEquals("""{"enabled":false,"recoveryLeft":0,"reset":true}""", c.api("GET", "/api/v1/me/2fa", null, e.token).body)
        assertEquals(409, c.api("POST", "/api/v1/admin/users/${e.id}/2fa/reset", null, admin).status, "nothing left to reset")
        assertEquals(404, c.api("POST", "/api/v1/admin/users/${UUID.randomUUID()}/2fa/reset", null, admin).status)
        val plain = client()
        plain.authorize()
        assertNotNull(plain.login(e.email, PW).code())

        val restart = c.api("POST", "/api/v1/me/2fa/start", null, e.token)
        assertEquals(200, restart.status)
        assertEquals(200, c.api("POST", "/api/v1/me/2fa/confirm", """{"code":"${Totp.code(field(restart.body, "secret")!!, step())}"}""", e.token).status)
        assertEquals("""{"enabled":true,"recoveryLeft":8,"reset":false}""", c.api("GET", "/api/v1/me/2fa", null, e.token).body)
    }
}
