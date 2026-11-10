package co.klei.app.web

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import co.klei.app.TestSupport
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.security.PermissionEpoch
import co.klei.app.security.SessionRegistry
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.storage.ObjectStorePort
import co.klei.crypto.TokenClaims
import co.klei.crypto.TokenSigner
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
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
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpRequest.BodyPublishers
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** Story 1.5: token checks, Permission checks, the `forbidden` audit, versions, idempotency, and no echo of input. */
@Testcontainers
@SpringBootTest(webEnvironment = RANDOM_PORT)
class SecurityIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }

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
    @Autowired lateinit var tokens: TokenSigner
    @Autowired lateinit var sessions: SessionRegistry
    @Autowired lateinit var epoch: PermissionEpoch
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var tx: TransactionTemplate

    private val http = HttpClient.newHttpClient()
    private val logs = ListAppender<ILoggingEvent>()
    private val root = LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME) as Logger
    private val port get() = ctx.webServer!!.port

    @BeforeEach fun capture() { logs.start(); root.addAppender(logs) }
    @AfterEach fun release() { root.detachAppender(logs); logs.stop() }

    private fun call(method: String, path: String, token: String? = null, headers: Map<String, String> = emptyMap(), body: String? = null): HttpResponse<String> {
        val b = HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path"))
            .method(method, if (body == null) BodyPublishers.noBody() else BodyPublishers.ofString(body))
        if (body != null) b.header("Content-Type", "application/json")
        token?.let { b.header("Authorization", "Bearer $it") }
        headers.forEach { (k, v) -> b.header(k, v) }
        return http.send(b.build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun problem(r: HttpResponse<String>, status: Int, code: String) {
        assertEquals(status, r.statusCode(), r.body())
        assertTrue(r.headers().firstValue("content-type").orElse("").startsWith("application/problem+json"))
        assertTrue(Regex("""\{"type":"[^"]+","title":"[^"]+","status":$status,"code":"$code","correlationId":"[0-9a-f-]{36}"\}""").matches(r.body()), r.body())
    }

    private fun adminId(): UUID = tx.execute { users.find(TestSupport.ADMIN_EMAIL)!!.id }!!
    private val adminPerms = listOf("PERM_VIEW_GALLERY", "PERM_UPLOAD_IMAGES", "PERM_EDIT_GOWN", "PERM_VIEW_AUDIT")

    private fun mint(sub: UUID, perms: List<String>, sid: String = UUID.randomUUID().toString(), iat: Long = Instant.now().epochSecond, exp: Long = iat + 900, ep: Long = epoch.current()) =
        tokens.sign(TokenClaims(sub.toString(), perms, sid, ep, iat, exp))

    private fun admin() = mint(adminId(), adminPerms)

    private fun viewer(): UUID = tx.execute {
        val rid = roles.roles().first { it.name == DefaultRoles.VIEWER }.id
        users.create("Vera Viewer", "vera-${UUID.randomUUID()}@example.test", "Viewer-pass-1", rid, UserStatus.ACTIVE, true).id
    }!!

    @Test fun `no token is unauthenticated`() = problem(call("GET", "/api/v1/me"), 401, "unauthenticated")

    @Test fun `garbage, tampered and expired tokens are unauthenticated`() {
        problem(call("GET", "/api/v1/me", "not.a.token"), 401, "unauthenticated")
        val t = admin()
        problem(call("GET", "/api/v1/me", t.dropLast(3) + if (t.endsWith("AAA")) "BBB" else "AAA"), 401, "unauthenticated")
        val now = Instant.now().epochSecond
        problem(call("GET", "/api/v1/me", mint(adminId(), adminPerms, iat = now - 1000, exp = now - 100)), 401, "unauthenticated")
    }

    @Test fun `a valid token reads me with role and permissions`() {
        val r = call("GET", "/api/v1/me", admin())
        assertEquals(200, r.statusCode())
        assertTrue(r.body().contains(""""email":"${TestSupport.ADMIN_EMAIL}""""), r.body())
        assertTrue(r.body().contains(""""role":"Admin""""), r.body())
        assertTrue(r.body().contains(""""PERM_VIEW_AUDIT""""), r.body())
    }

    @Test fun `unknown path with a valid token is a bare 404`() = problem(call("GET", "/api/v1/nope", admin()), 404, "not_found")

    @Test fun `a token issued before this process started is stale`() =
        problem(call("GET", "/api/v1/me", mint(adminId(), adminPerms, iat = sessions.startedAt.epochSecond - 60)), 401, "token_stale")

    @Test fun `a revoked session is stale`() {
        val sid = UUID.randomUUID().toString()
        val t = mint(adminId(), adminPerms, sid = sid)
        assertEquals(200, call("GET", "/api/v1/me", t).statusCode())
        sessions.revoke(sid)
        problem(call("GET", "/api/v1/me", t), 401, "token_stale")
    }

    @Test fun `a permission change makes older tokens stale at once`() {
        val old = admin()
        assertEquals(200, call("GET", "/api/v1/me", old).statusCode())
        tx.execute { epoch.bump() }
        problem(call("GET", "/api/v1/me", old), 401, "token_stale")
        assertEquals(200, call("GET", "/api/v1/me", admin()).statusCode())
    }

    @Test fun `a missing permission is forbidden and audited with route actor and ip`() {
        val id = viewer()
        val t = mint(id, listOf("PERM_VIEW_GALLERY"))
        assertEquals(200, call("GET", "/api/v1/probe/gallery", t).statusCode())
        problem(call("GET", "/api/v1/probe/audit", t), 403, "forbidden")
        val e = tx.execute { audit.all().filter { it.action == "forbidden" && it.actorId == id.toString() } }!!
        assertEquals(1, e.size)
        assertEquals("GET /api/v1/probe/audit", e[0].detail)
        assertEquals("Vera Viewer", e[0].actorName)
        assertEquals("127.0.0.1", e[0].ip)
    }

    @Test fun `a forbidden request with a path value never puts the raw path in the audit`() {
        val id = viewer()
        call("GET", "/api/v1/probe/audit?q=SENTINEL-query-7", mint(id, listOf("PERM_VIEW_GALLERY")))
        val e = tx.execute { audit.all().filter { it.actorId == id.toString() } }!!
        assertTrue(e.none { (it.detail ?: "").contains("SENTINEL") })
    }

    @Test fun `if-match - missing is 400, stale is 409, current returns the next version`() {
        val t = admin()
        problem(call("PATCH", "/api/v1/probe/thing", t), 400, "bad_request")
        problem(call("PATCH", "/api/v1/probe/thing", t, mapOf("If-Match" to "999")), 409, "conflict")
        val first = call("PATCH", "/api/v1/probe/thing", t, mapOf("If-Match" to "\"1\""))
        assertEquals(200, first.statusCode())
        assertEquals("""{"version":2}""", first.body())
        problem(call("PATCH", "/api/v1/probe/thing", t, mapOf("If-Match" to "1")), 409, "conflict")
    }

    @Test fun `idempotency-key replays the first result and creates nothing twice`() {
        val t = admin()
        fun count() = call("GET", "/api/v1/probe/things/count", t).body()
        val before = count()
        val key = mapOf("Idempotency-Key" to "k-${UUID.randomUUID()}")
        val a = call("POST", "/api/v1/probe/things", t, key, """{"a":"b"}""")
        val b = call("POST", "/api/v1/probe/things", t, key, """{"a":"b"}""")
        assertEquals(200, a.statusCode())
        assertEquals(a.body(), b.body())
        val c = call("POST", "/api/v1/probe/things", t, mapOf("Idempotency-Key" to "k-${UUID.randomUUID()}"), """{"a":"b"}""")
        assertNotEquals(a.body(), c.body())
        val n = Regex("""\d+""").find(count())!!.value.toInt() - Regex("""\d+""").find(before)!!.value.toInt()
        assertEquals(2, n)
        problem(call("POST", "/api/v1/probe/things", t, mapOf("Idempotency-Key" to "x".repeat(200)), """{"a":"b"}"""), 400, "bad_request")
    }

    @Test fun `public probe path needs no token while a protected one without a token is 401`() {
        assertEquals(200, call("GET", "/api/v1/probe/open").statusCode())
        problem(call("GET", "/api/v1/probe/gallery"), 401, "unauthenticated")
    }

    @Test fun `malformed json, a wrong token and an oversized body echo nothing`() {
        val t = admin()
        val bad = call("POST", "/api/v1/probe/things", t, body = """{"SENTINEL-json-5": [""")
        problem(bad, 400, "bad_request")
        val wrong = call("GET", "/api/v1/me", "SENTINEL-token-5.SENTINEL.SENTINEL")
        problem(wrong, 401, "unauthenticated")
        val big = call("POST", "/api/v1/probe/things", t, body = """{"v":"SENTINEL-big-5${"x".repeat(1_500_000)}"}""")
        problem(big, 413, "too_large")
        assertFalse(listOf(bad, wrong, big).any { it.body().contains("SENTINEL") })
        assertFalse(logs.list.any { it.formattedMessage.contains("SENTINEL") || it.throwableProxy != null })
    }
}
