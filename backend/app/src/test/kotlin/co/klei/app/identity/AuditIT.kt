package co.klei.app.identity

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.mail.RecordingMailConfig
import co.klei.core.audit.AuditAction
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.storage.ObjectStorePort
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
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Story 2.5: the Audit log read side. Paging, order, who may read, nothing to write. */
@Testcontainers
@Import(RecordingMailConfig::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class AuditIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Audit-pass-1"

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
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var tx: TransactionTemplate

    private val port get() = ctx.webServer!!.port
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:$port")
    private fun token(email: String, pw: String): String {
        val c = client()
        return field(c.exchange(c.signIn(email, pw)).body, "accessToken")!!
    }
    private fun admin() = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
    private fun get(path: String, t: String? = null) = client().api("GET", path, null, t)
    private fun total() = tx.execute { audit.all().size }!!

    @Test fun `only View audit log reads it, and a refusal is itself audited`() {
        assertEquals(401, get("/api/v1/admin/audit").status)
        val email = "v-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Vera Viewer", email, PW, roles.roles().first { it.name == DefaultRoles.VIEWER }.id, UserStatus.ACTIVE, true) }
        assertEquals(403, get("/api/v1/admin/audit", token(email, PW)).status)
        val body = get("/api/v1/admin/audit", admin())
        assertEquals(200, body.status, body.body)
        assertTrue(tx.execute { audit.all().any { it.action == "forbidden" && it.detail == "GET /api/v1/admin/audit" } }!!)
    }

    @Test fun `50 rows a page, newest first, Page n of m, and an empty page past the end`() {
        tx.executeWithoutResult { for (i in 1..120) audit.record(AuditAction.GOWN_EDITED, "row-$i", actorName = "Pager", ip = "10.0.0.$i") }
        val t = admin()
        val pages = (total() + 49) / 50
        val first = get("/api/v1/admin/audit", t).body
        assertEquals(50, Regex(""""action":""").findAll(first).count())
        assertTrue(first.contains(""""page":1,"pages":$pages"""), first)
        assertTrue(first.indexOf("row-120") in 0 until first.indexOf("row-119"), "newest first")
        val second = get("/api/v1/admin/audit?page=2", t).body
        assertTrue(second.contains(""""page":2"""))
        assertTrue(second.contains("row-70") && !second.contains("row-120"))
        val past = get("/api/v1/admin/audit?page=${pages + 1}", t).body
        assertEquals(0, Regex(""""action":""").findAll(past).count())
        assertTrue(past.contains(""""items":[]"""), past)
    }

    @Test fun `a row carries time, actor, action code, detail and IP, nothing else`() {
        tx.executeWithoutResult { audit.record(AuditAction.USER_DELETED, "Gone Person", actorName = "Ada Admin", ip = "203.0.113.9") }
        val body = get("/api/v1/admin/audit", admin()).body
        val row = Regex("""\{"id":"[^"]+","ts":"[^"]+","actor":"Ada Admin","action":"user_deleted","detail":"Gone Person","ip":"203.0.113.9"\}""").find(body)
        assertTrue(row != null, body)
    }

    @Test fun `page must be a positive whole number`() {
        val t = admin()
        assertEquals(422, get("/api/v1/admin/audit?page=0", t).status)
        assertEquals(422, get("/api/v1/admin/audit?page=-3", t).status)
        assertEquals(422, get("/api/v1/admin/audit?page=99999999", t).status)
        assertTrue(get("/api/v1/admin/audit?page=abc", t).status in 400..422)
    }

    @Test fun `nothing writes through the API`() {
        val t = admin()
        for (m in listOf("POST", "PUT", "PATCH", "DELETE")) {
            val s = client().api(m, "/api/v1/admin/audit", "{}", t, mapOf("If-Match" to "1")).status
            assertTrue(s in listOf(404, 405), "$m gave $s")
        }
    }
}
