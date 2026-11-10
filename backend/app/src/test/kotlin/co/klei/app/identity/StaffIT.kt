package co.klei.app.identity

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.mail.RecordingMail
import co.klei.app.mail.RecordingMailConfig
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.mail.MailTemplate
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
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Story 2.3: staff list, edit, resend, delete, the last-Admin guard and "last active". */
@Testcontainers
@Import(RecordingMailConfig::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class StaffIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Staffer-pass-1"

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
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var tx: TransactionTemplate

    private val port get() = ctx.webServer!!.port
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:$port")
    private fun token(email: String, pw: String): String? {
        val c = client()
        return field(c.exchange(c.signIn(email, pw)).body, "accessToken")
    }
    private fun adminToken() = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)!!
    private fun roleId(name: String) = roles.roles().first { it.name == name }.id
    private fun audits(action: String) = tx.execute { audit.all().filter { it.action == action } }!!

    private fun active(role: String, name: String = "Sam Staff"): Pair<UUID, String> {
        val email = "s-${UUID.randomUUID()}@example.test"
        val id = tx.execute { users.create(name, email, PW, roleId(role), UserStatus.ACTIVE, true).id }!!
        return id to email
    }

    private fun rows(t: String): List<Map<String, String?>> {
        val body = client().api("GET", "/api/v1/admin/users", null, t).body
        return Regex("""\{"id":"([^"]+)","name":"((?:[^"\\]|\\.)*)","email":"([^"]+)","roleId":"([^"]+)","role":"([^"]+)","status":"([^"]+)","lastActive":(null|"[^"]+"),"hasAvatar":(true|false),"lastAdmin":(true|false),"version":(\d+),"twoFactor":(?:true|false)\}""")
            .findAll(body).map { m ->
                val g = m.groupValues
                mapOf("id" to g[1], "name" to g[2], "email" to g[3], "roleId" to g[4], "role" to g[5], "status" to g[6], "lastActive" to g[7],
                    "hasAvatar" to g[8], "lastAdmin" to g[9], "version" to g[10])
            }.toList()
    }

    private fun row(t: String, id: UUID) = rows(t).first { it["id"] == id.toString() }
    private fun patch(t: String, id: UUID, json: String, version: String?) =
        client().api("PATCH", "/api/v1/admin/users/$id", json, t, version?.let { mapOf("If-Match" to it) } ?: emptyMap())

    @Test fun `only a caller with the staff permission sees the list, the lone Admin is flagged and Roles come with it`() {
        val c = client()
        assertEquals(401, c.api("GET", "/api/v1/admin/users").status)
        val (_, viewerEmail) = active(DefaultRoles.VIEWER)
        assertEquals(403, c.api("GET", "/api/v1/admin/users", null, token(viewerEmail, PW)).status)
        val t = adminToken()
        val r = c.api("GET", "/api/v1/admin/users", null, t)
        assertEquals(200, r.status, r.body)
        assertTrue(r.body.contains("\"roles\":[") && r.body.contains("\"next\":null") && r.body.contains("\"total\":"))
        val admin = rows(t).first { it["email"] == TestSupport.ADMIN_EMAIL }
        assertEquals("active", admin["status"])
        assertEquals("Admin", admin["role"])
        assertEquals("true", admin["lastAdmin"])
        assertNotNull(admin["lastActive"]?.takeIf { it != "null" })
        assertEquals("false", admin["hasAvatar"])
    }

    @Test fun `edit changes only what is sent, needs the current version and writes an audit entry`() {
        val t = adminToken()
        val (id, _) = active(DefaultRoles.STAFF)
        val v = row(t, id)["version"]!!
        assertEquals(400, patch(t, id, """{"name":"Sam Renamed"}""", null).status)
        assertEquals(409, patch(t, id, """{"name":"Sam Renamed"}""", (v.toLong() + 5).toString()).status)
        assertEquals(422, patch(t, id, """{"name":""}""", v).status)
        assertEquals(422, patch(t, id, """{"email":"nope"}""", v).status)
        assertEquals(422, patch(t, id, """{"roleId":"${UUID.randomUUID()}"}""", v).status)
        assertEquals(404, patch(t, UUID.randomUUID(), """{"name":"X"}""", v).status)
        val ok = patch(t, id, """{"name":"Sam Renamed"}""", v)
        assertEquals(200, ok.status, ok.body)
        val after = row(t, id)
        assertEquals("Sam Renamed", after["name"])
        assertEquals("Staff", after["role"])
        assertEquals((v.toLong() + 1).toString(), after["version"])
        assertEquals(409, patch(t, id, """{"name":"Again"}""", v).status)
        assertTrue(audits("user_updated").any { it.detail == "Sam Renamed" })
    }

    @Test fun `an email already in use is a conflict`() {
        val t = adminToken()
        val (id, _) = active(DefaultRoles.STAFF)
        val (_, other) = active(DefaultRoles.STAFF)
        assertEquals(409, patch(t, id, """{"email":"${other.uppercase()}"}""", row(t, id)["version"]).status)
    }

    @Test fun `a Role change ends the User's sign-ins and the new Permissions apply at once`() {
        val t = adminToken()
        val (id, email) = active(DefaultRoles.STAFF)
        val before = token(email, PW)!!
        val c = client()
        assertEquals(200, c.api("GET", "/api/v1/me", null, before).status)
        assertEquals(200, patch(t, id, """{"roleId":"${roleId(DefaultRoles.VIEWER)}"}""", row(t, id)["version"]).status)
        assertEquals(401, c.api("GET", "/api/v1/me", null, before).status)
        val again = token(email, PW)!!
        assertTrue(c.api("GET", "/api/v1/me", null, again).body.contains("\"role\":\"Viewer\""))
        assertTrue(audits("user_role_changed").any { it.detail == "Sam Staff" })
    }

    @Test fun `the last Active Admin can be neither demoted nor deleted`() {
        val t = adminToken()
        val admin = users.find(TestSupport.ADMIN_EMAIL)!!
        val staff = roleId(DefaultRoles.STAFF)
        assertEquals(409, patch(t, admin.id, """{"roleId":"$staff"}""", row(t, admin.id)["version"]).status)
        assertEquals(409, client().api("DELETE", "/api/v1/admin/users/${admin.id}", null, t).status)
        assertEquals(200, patch(t, admin.id, """{"name":"Studio Admin"}""", row(t, admin.id)["version"]).status)

        val (second, secondEmail) = active(DefaultRoles.ADMIN, "Second Admin")
        assertEquals("false", row(t, admin.id)["lastAdmin"])
        val st = token(secondEmail, PW)!!
        assertEquals(200, patch(st, admin.id, """{"roleId":"$staff"}""", row(st, admin.id)["version"]).status)
        val st2 = token(secondEmail, PW)!! // the Role change bumped the epoch, so the first token is stale by design
        assertEquals(409, client().api("DELETE", "/api/v1/admin/users/$second", null, st2).status)
        assertEquals(200, patch(st2, admin.id, """{"roleId":"${roleId(DefaultRoles.ADMIN)}"}""", row(st2, admin.id)["version"]).status)
    }

    @Test fun `an Invited Admin does not count as an Admin`() {
        val t = adminToken()
        val inv = client().api("POST", "/api/v1/admin/users", """{"name":"Ina Invited","email":"ina-${UUID.randomUUID()}@example.test","roleId":"${roleId(DefaultRoles.ADMIN)}"}""", t)
        assertEquals(201, inv.status, inv.body)
        val admin = users.find(TestSupport.ADMIN_EMAIL)!!
        assertEquals(409, client().api("DELETE", "/api/v1/admin/users/${admin.id}", null, t).status)
    }

    @Test fun `resend replaces the invitation and refuses an Active User`() {
        val t = adminToken()
        val email = "rae-${UUID.randomUUID()}@example.test"
        val c = client()
        val created = c.api("POST", "/api/v1/admin/users", """{"name":"Rae Resend","email":"$email","roleId":"${roleId(DefaultRoles.VIEWER)}"}""", t)
        val id = UUID.fromString(field(created.body, "id")!!)
        val first = mail.last(MailTemplate.INVITE, email).model.getValue("link").substringAfter('#')
        assertEquals(204, c.api("POST", "/api/v1/admin/users/$id/resend", null, t).status)
        val second = mail.last(MailTemplate.INVITE, email).model.getValue("link").substringAfter('#')
        assertEquals(2, mail.sent.count { it.template == MailTemplate.INVITE && it.to == email })
        assertFalse(first == second)
        assertEquals(410, client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to first)).status)
        assertEquals(200, client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to second)).status)
        assertTrue(audits("user_invite_resent").any { it.detail == "Rae Resend" })
        val (activeId, _) = active(DefaultRoles.STAFF)
        assertEquals(409, c.api("POST", "/api/v1/admin/users/$activeId/resend", null, t).status)
        assertEquals(404, c.api("POST", "/api/v1/admin/users/${UUID.randomUUID()}/resend", null, t).status)
    }

    @Test fun `changing an Invited User's email sends a new invitation to it`() {
        val t = adminToken()
        val c = client()
        val old = "old-${UUID.randomUUID()}@example.test"
        val fresh = "new-${UUID.randomUUID()}@example.test"
        val id = UUID.fromString(field(c.api("POST", "/api/v1/admin/users", """{"name":"Ned","email":"$old","roleId":"${roleId(DefaultRoles.VIEWER)}"}""", t).body, "id")!!)
        val oldTok = mail.last(MailTemplate.INVITE, old).model.getValue("link").substringAfter('#')
        assertEquals(200, patch(t, id, """{"email":"$fresh"}""", row(t, id)["version"]).status)
        assertEquals(410, client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to oldTok)).status)
        val view = client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to mail.last(MailTemplate.INVITE, fresh).model.getValue("link").substringAfter('#')))
        assertEquals(200, view.status)
        assertTrue(view.body.contains(fresh))
    }

    @Test fun `delete ends the User's access at once and removes the row`() {
        val t = adminToken()
        val (id, email) = active(DefaultRoles.STAFF, "Dee Deleted")
        val theirs = token(email, PW)!!
        val c = client()
        assertEquals(200, c.api("GET", "/api/v1/me", null, theirs).status)
        assertEquals(204, c.api("DELETE", "/api/v1/admin/users/$id", null, t).status)
        assertEquals(401, c.api("GET", "/api/v1/me", null, theirs).status)
        assertNull(users.find(email))
        assertTrue(rows(adminToken()).none { it["id"] == id.toString() })
        assertTrue(audits("user_deleted").any { it.detail == "Dee Deleted" })
        assertEquals(404, c.api("DELETE", "/api/v1/admin/users/$id", null, adminToken()).status)
        val x = client().also { it.authorize() }
        assertEquals(401, x.login(email, PW).status)
    }

    @Test fun `deleting an Invited User drops the invitation and the invitations they sent keep working`() {
        val t = adminToken()
        val c = client()
        val email = "gone-${UUID.randomUUID()}@example.test"
        val id = UUID.fromString(field(c.api("POST", "/api/v1/admin/users", """{"name":"Gus Gone","email":"$email","roleId":"${roleId(DefaultRoles.VIEWER)}"}""", t).body, "id")!!)
        val tok = mail.last(MailTemplate.INVITE, email).model.getValue("link").substringAfter('#')
        assertEquals(204, c.api("DELETE", "/api/v1/admin/users/$id", null, adminToken()).status)
        assertEquals(410, client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to tok)).status)

        val (inviterId, inviterEmail) = active(DefaultRoles.ADMIN, "Ida Inviter")
        val guest = "guest-${UUID.randomUUID()}@example.test"
        assertEquals(201, c.api("POST", "/api/v1/admin/users", """{"name":"Gia Guest","email":"$guest","roleId":"${roleId(DefaultRoles.VIEWER)}"}""", token(inviterEmail, PW)).status)
        val gtok = mail.last(MailTemplate.INVITE, guest).model.getValue("link").substringAfter('#')
        assertEquals(204, c.api("DELETE", "/api/v1/admin/users/$inviterId", null, adminToken()).status)
        assertEquals(200, client().also { it.get("/invite") }.submit("/invite/open", mapOf("token" to gtok)).status)
    }

    @Test fun `last active moves at most once an hour`() {
        val (id, email) = active(DefaultRoles.STAFF)
        assertNull(tx.execute { users.get(id)!!.lastActive })
        token(email, PW)
        val first = tx.execute { users.get(id)!!.lastActive }
        assertNotNull(first)
        token(email, PW)
        assertEquals(first, tx.execute { users.get(id)!!.lastActive })
        val t = tx.execute { val u = users.get(id)!!; users.touch(u, first!!.plusSeconds(3601)); u.lastActive }
        assertEquals(first!!.plusSeconds(3601), t)
    }
}
