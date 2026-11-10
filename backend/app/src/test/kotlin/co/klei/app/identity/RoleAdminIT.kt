package co.klei.app.identity

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.mail.RecordingMailConfig
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
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** Story 2.4: the Role matrix, whole-set replace, immediate effect through the epoch, the zero-Permission lockout. */
@Testcontainers
@Import(RecordingMailConfig::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class RoleAdminIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Roler-pass-1"
        private val STAFF_DEFAULT = listOf("PERM_VIEW_GALLERY", "PERM_UPLOAD_IMAGES", "PERM_EDIT_GOWN", "PERM_REPLY", "PERM_CLOSE_INQUIRY")

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
    private fun signIn(email: String, pw: String): Pair<String, String> {
        val c = client()
        val body = c.exchange(c.signIn(email, pw)).body
        return field(body, "accessToken")!! to field(body, "refreshToken")!!
    }
    private fun roleId(name: String) = roles.roles().first { it.name == name }.id
    private fun user(role: String): String {
        val email = "r-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Rae Role", email, PW, roleId(role), UserStatus.ACTIVE, true) }
        return email
    }
    private fun refresh(rt: String) = client().api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$rt"}""")
    private fun me(t: String) = client().api("GET", "/api/v1/me", null, t)

    /** The matrix as the Admin sees it: the Role's `version` and granted names. Each call signs in again, because every change stales the old token. */
    private fun view(role: String): Pair<Long, List<String>> {
        val t = signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD).first
        val body = client().api("GET", "/api/v1/admin/roles", null, t).body
        val m = Regex("""\{"id":"[^"]+","name":"$role","locked":(?:true|false),"permissions":\[([^\]]*)],"version":(\d+)\}""").find(body)!!
        return m.groupValues[2].toLong() to Regex(""""([A-Z_]+)"""").findAll(m.groupValues[1]).map { it.groupValues[1] }.toList()
    }

    private fun put(role: String, perms: List<String>, ifMatch: String? = null, roleIdOverride: UUID? = null): AuthWebClient.Page {
        val v = view(role).first
        val t = signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD).first
        val json = """{"roleId":"${roleIdOverride ?: roleId(role)}","permissions":[${perms.joinToString(",") { "\"$it\"" }}]}"""
        return client().api("PUT", "/api/v1/admin/roles", json, t, mapOf("If-Match" to (ifMatch ?: v.toString())))
    }

    private fun restore() { put(DefaultRoles.STAFF, STAFF_DEFAULT); put(DefaultRoles.VIEWER, listOf("PERM_VIEW_GALLERY")) }

    @Test fun `the matrix lists three Roles and nine Permissions, Admin locked, and only the staff permission sees it`() {
        val c = client()
        assertEquals(401, c.api("GET", "/api/v1/admin/roles").status)
        assertEquals(403, c.api("GET", "/api/v1/admin/roles", null, signIn(user(DefaultRoles.VIEWER), PW).first).status)
        val body = c.api("GET", "/api/v1/admin/roles", null, signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD).first).body
        assertTrue(body.startsWith("""{"permissions":["PERM_VIEW_GALLERY","PERM_UPLOAD_IMAGES","PERM_EDIT_GOWN","PERM_DELETE_GOWN","PERM_REPLY","PERM_CLOSE_INQUIRY","PERM_MANAGE_STAFF","PERM_AI_SETTINGS","PERM_VIEW_AUDIT"]"""), body)
        assertFalse(body.contains("PERM_KEY_ROTATE"))
        assertEquals(listOf("Admin", "Staff", "Viewer"), Regex(""""name":"(\w+)"""").findAll(body).map { it.groupValues[1] }.toList())
        assertTrue(body.contains(""""name":"Admin","locked":true"""))
        assertTrue(body.contains(""""name":"Staff","locked":false"""))
        assertEquals(STAFF_DEFAULT, view(DefaultRoles.STAFF).second)
    }

    @Test fun `a change replaces the set, stales the old token, keeps the sign-in and audits what changed`() {
        val (at, rt) = signIn(user(DefaultRoles.STAFF), PW)
        assertTrue(me(at).body.contains("PERM_UPLOAD_IMAGES"))
        val (v0) = view(DefaultRoles.STAFF)
        try {
            val r = put(DefaultRoles.STAFF, STAFF_DEFAULT - "PERM_UPLOAD_IMAGES" + "PERM_DELETE_GOWN")
            assertEquals(200, r.status, r.body)
            assertEquals(v0 + 1, Regex(""""version":(\d+)""").find(r.body)!!.groupValues[1].toLong())
            assertFalse(r.body.contains("PERM_UPLOAD_IMAGES"))
            assertTrue(r.body.contains("PERM_DELETE_GOWN"))

            val stale = me(at)
            assertEquals(401, stale.status)
            assertTrue(stale.body.contains("token_stale"), stale.body)
            val next = refresh(rt)
            assertEquals(200, next.status, next.body)
            val fresh = field(next.body, "accessToken")!!
            val perms = me(fresh).body
            assertFalse(perms.contains("PERM_UPLOAD_IMAGES"), perms)
            assertTrue(perms.contains("PERM_DELETE_GOWN"), perms)

            val entries = tx.execute { audit.all().filter { it.action == "role_permissions_changed" }.map { it.detail } }!!
            assertTrue("Staff: +PERM_DELETE_GOWN -PERM_UPLOAD_IMAGES" in entries, entries.toString())
        } finally { restore() }
    }

    @Test fun `the same set again is a no-op that keeps every token valid`() {
        val (at) = signIn(user(DefaultRoles.STAFF), PW)
        val (v0) = view(DefaultRoles.STAFF)
        val r = put(DefaultRoles.STAFF, STAFF_DEFAULT.reversed())
        assertEquals(200, r.status, r.body)
        assertEquals(v0, Regex(""""version":(\d+)""").find(r.body)!!.groupValues[1].toLong())
        assertEquals(200, me(at).status)
    }

    @Test fun `refusals - Admin Role, unknown Role, unknown or non-editable Permission, stale or missing version, no permission`() {
        val v = view(DefaultRoles.STAFF).first
        assertEquals(422, put(DefaultRoles.ADMIN, listOf("PERM_VIEW_GALLERY")).status)
        assertEquals(422, put(DefaultRoles.STAFF, listOf("PERM_VIEW_GALLERY"), roleIdOverride = UUID.randomUUID()).status)
        assertEquals(422, put(DefaultRoles.STAFF, listOf("PERM_VIEW_GALLERY", "PERM_NOPE")).status)
        assertEquals(422, put(DefaultRoles.STAFF, listOf("PERM_VIEW_GALLERY", "PERM_KEY_ROTATE")).status)
        assertEquals(409, put(DefaultRoles.STAFF, STAFF_DEFAULT, ifMatch = (v + 7).toString()).status)
        val t = signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD).first
        val json = """{"roleId":"${roleId(DefaultRoles.STAFF)}","permissions":["PERM_VIEW_GALLERY"]}"""
        assertEquals(400, client().api("PUT", "/api/v1/admin/roles", json, t).status)
        val viewer = signIn(user(DefaultRoles.VIEWER), PW).first
        assertEquals(403, client().api("PUT", "/api/v1/admin/roles", json, viewer, mapOf("If-Match" to v.toString())).status)
        assertEquals(STAFF_DEFAULT, view(DefaultRoles.STAFF).second)
    }

    @Test fun `a Role with no Permission locks its Users out, and one Permission back lets them in`() {
        val email = user(DefaultRoles.VIEWER)
        val (at, rt) = signIn(email, PW)
        try {
            assertEquals(200, put(DefaultRoles.VIEWER, emptyList()).status)
            val stale = me(at)
            assertEquals(401, stale.status)
            assertTrue(stale.body.contains("token_stale"))
            assertEquals(403, refresh(rt).status)
            assertEquals(401, refresh(rt).status)
            val c = client()
            c.authorize()
            assertEquals(403, c.login(email, PW).status)

            assertEquals(200, put(DefaultRoles.VIEWER, listOf("PERM_VIEW_GALLERY")).status)
            assertEquals(200, me(signIn(email, PW).first).status)
        } finally { restore() }
    }

    @Test fun `a Viewer granted the reply Permission gets it with no role name checked`() {
        val email = user(DefaultRoles.VIEWER)
        try {
            assertEquals(200, put(DefaultRoles.VIEWER, listOf("PERM_VIEW_GALLERY", "PERM_REPLY")).status)
            val body = me(signIn(email, PW).first).body
            assertTrue(body.contains("\"role\":\"Viewer\"") && body.contains("PERM_REPLY"), body)
            assertNotEquals(-1, body.indexOf("PERM_VIEW_GALLERY"))
        } finally { restore() }
    }
}
