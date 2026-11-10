package co.klei.app.inquiry

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMail
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.upload.FakeStore
import co.klei.app.upload.RecordingNotes
import co.klei.app.upload.UploadClient
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import org.springframework.jdbc.core.JdbcTemplate
import java.net.ServerSocket
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 7.4: status changes and who may close, Client edits, the reopen rule. Own context: it trims the Staff Role. */
@Testcontainers
@Import(RecordingMailConfig::class, StatusIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class StatusIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
        @Bean @Primary fun notes() = RecordingNotes()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Status-pass-1"
        private val STAFF_NO_CLOSE = listOf("PERM_VIEW_GALLERY", "PERM_UPLOAD_IMAGES", "PERM_EDIT_GOWN", "PERM_REPLY")

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

    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var state: InquiryStateService
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private val client get() = AuthWebClient("http://127.0.0.1:$authPort", api)
    private var trimmed = false

    private fun token(email: String, password: String) = field(client.let { it.exchange(it.signIn(email, password)).body }, "accessToken")!!

    /** Staff loses `PERM_CLOSE_INQUIRY` once; Admin keeps it. */
    private fun trimStaff() {
        if (trimmed) return
        val admin = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
        val list = client.api("GET", "/api/v1/admin/roles", null, admin).body
        val m = Regex("""\{"id":"([^"]+)","name":"Staff","locked":(?:true|false),"permissions":\[[^\]]*],"version":(\d+)\}""").find(list)!!
        val json = """{"roleId":"${m.groupValues[1]}","permissions":[${STAFF_NO_CLOSE.joinToString(",") { "\"$it\"" }}]}"""
        assertEquals(200, client.api("PUT", "/api/v1/admin/roles", json, admin, mapOf("If-Match" to m.groupValues[2])).status)
        trimmed = true
    }

    private fun person(role: String): String {
        trimStaff()
        val email = "st-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        tx.execute { users.create("Status Person", email, PW, rid, UserStatus.ACTIVE, true) }
        return token(email, PW)
    }

    private fun admin() = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)

    private fun call(method: String, path: String, token: String?, json: String? = null, headers: Map<String, String> = emptyMap()) =
        UploadClient.call(method, "$api$path", token, json?.toByteArray(), buildMap { if (json != null) put("Content-Type", "application/json"); putAll(headers) })

    private fun str(json: String, key: String) = Regex(""""$key":"((?:[^"\\]|\\.)*)"""").find(json)!!.groupValues[1]
    private fun num(json: String, key: String) = Regex(""""$key":(\d+)""").find(json)!!.groupValues[1].toLong()
    private class Made(val id: String, val client: String)
    private fun make(token: String): Made {
        val client = "client-${UUID.randomUUID()}@example.test"
        val r = call("POST", "/api/v1/inquiries", token, """{"clientName":"Mara Lindqvist","clientEmail":"$client","subject":"Fitting","body":"Hello"}""")
        assertEquals(201, r.status, r.text)
        return Made(str(r.text, "id"), client)
    }
    private fun version(token: String, id: String) = num(call("GET", "/api/v1/inquiries/$id", token).text, "version")
    private fun setStatus(token: String, id: String, status: String, ifMatch: Long? = null) =
        call("PATCH", "/api/v1/inquiries/$id", token, """{"status":"$status"}""", mapOf("If-Match" to (ifMatch ?: version(token, id)).toString()))

    @Test
    fun `status moves between the three values, bumps the version, keeps the order, is audited and filters`() {
        val staff = person(DefaultRoles.STAFF)
        val a = make(staff)
        val b = make(staff)
        val before = version(staff, a.id)
        val replied = setStatus(staff, a.id, "replied")
        assertEquals(200, replied.status, replied.text)
        assertEquals("replied", str(replied.text, "status"))
        assertEquals(before + 1, num(replied.text, "version"))
        // a status change is not activity: b (made later) still sorts first
        val ids = Regex(""""id":"([0-9a-f-]{36})"""").findAll(call("POST", "/api/v1/inquiries/query", staff, "{}").text).map { it.groupValues[1] }.toList()
        assertTrue(ids.indexOf(b.id) in 0 until ids.indexOf(a.id), ids.toString())
        assertEquals(200, setStatus(staff, a.id, "new").status)
        assertEquals(200, setStatus(staff, a.id, "replied").status)
        // the same status again: nothing written, same version
        val v = version(staff, a.id)
        val same = setStatus(staff, a.id, "replied", v)
        assertEquals(200, same.status)
        assertEquals(v, num(same.text, "version"))
        // filters and the three index values
        val admin = admin()
        val c = make(admin)
        assertEquals(200, setStatus(admin, c.id, "closed").status)
        val closed = call("POST", "/api/v1/inquiries/query", staff, """{"status":"closed"}""")
        assertTrue(closed.text.contains(c.id) && !closed.text.contains(a.id) && !closed.text.contains(b.id), closed.text)
        val bidx = jdbc.query("select distinct status_bidx from inquiry") { rs, _ -> rs.getBytes(1) }
        assertEquals(3, bidx.size)
        assertTrue(bidx.all { it.size == 32 })
        // audit: old and new words, no names or subjects
        val entries = tx.execute { audit.all().filter { it.action == "inquiry_status_changed" } }!!
        assertTrue(entries.any { it.detail == "new to replied" } && entries.any { it.detail == "new to closed" }, entries.map { it.detail }.toString())
        assertTrue(entries.none { it.detail?.contains("Fitting") == true || it.detail?.contains("Mara") == true })
    }

    @Test
    fun `a stale version, an unknown status, a missing header, a missing inquiry and no permission are refused`() {
        val staff = person(DefaultRoles.STAFF)
        val viewer = person(DefaultRoles.VIEWER)
        val q = make(staff)
        val v = version(staff, q.id)
        assertEquals(409, setStatus(staff, q.id, "replied", v + 5).status)
        val bad = setStatus(staff, q.id, "archived", v)
        assertEquals(422, bad.status, bad.text)
        assertTrue(bad.text.contains("\"field\":\"status\"") && bad.text.contains("\"code\":\"invalid\""), bad.text)
        assertEquals(422, call("PATCH", "/api/v1/inquiries/${q.id}", staff, "{}", mapOf("If-Match" to v.toString())).status)
        assertEquals(400, call("PATCH", "/api/v1/inquiries/${q.id}", staff, """{"status":"replied"}""").status)
        assertEquals(404, setStatus(staff, UUID.randomUUID().toString(), "replied", 0).status)
        assertEquals(403, setStatus(viewer, q.id, "replied", v).status)
        assertEquals("new", str(call("GET", "/api/v1/inquiries/${q.id}", staff).text, "status"))
    }

    @Test
    fun `closing and reopening need the close permission, and the refusal is audited`() {
        val staff = person(DefaultRoles.STAFF)
        val admin = admin()
        val q = make(staff)
        val refused = setStatus(staff, q.id, "closed")
        assertEquals(403, refused.status, refused.text)
        assertEquals("new", str(call("GET", "/api/v1/inquiries/${q.id}", staff).text, "status"))
        val forbidden = tx.execute { audit.all().filter { it.action == "forbidden" && it.detail == "PATCH /api/v1/inquiries/{id}" } }!!
        assertTrue(forbidden.isNotEmpty())
        assertEquals(200, setStatus(admin, q.id, "closed").status)
        assertEquals(403, setStatus(staff, q.id, "new").status)
        assertEquals("closed", str(call("GET", "/api/v1/inquiries/${q.id}", staff).text, "status"))
        assertEquals(200, setStatus(admin, q.id, "new").status)
        assertEquals(200, setStatus(staff, q.id, "replied").status)
    }

    @Test
    fun `a Client edit saves the five fields with the version, validates, and refuses a stale or unpermitted call`() {
        val staff = person(DefaultRoles.STAFF)
        val viewer = person(DefaultRoles.VIEWER)
        val q = make(staff)
        val clientId = str(call("GET", "/api/v1/inquiries/${q.id}", staff).text, "id").let {
            Regex(""""client":\{"id":"([0-9a-f-]{36})"""").find(call("GET", "/api/v1/inquiries/${q.id}", staff).text)!!.groupValues[1]
        }
        val path = "/api/v1/clients/$clientId"
        val v = num(call("GET", path, staff).text, "version")
        val body = """{"phone":"+351 912 345 678","city":"Lisbon","weddingDate":"2027-05-14","source":"Instagram","note":"Prefers lace\nSecond line"}"""
        val ok = call("PATCH", path, staff, body, mapOf("If-Match" to v.toString()))
        assertEquals(200, ok.status, ok.text)
        assertEquals(v + 1, num(ok.text, "version"))
        for (f in listOf("+351 912 345 678", "Lisbon", "2027-05-14", "Instagram", "Prefers lace")) assertTrue(ok.text.contains(f), ok.text)
        assertEquals(409, call("PATCH", path, staff, body, mapOf("If-Match" to v.toString())).status)
        assertEquals(400, call("PATCH", path, staff, body).status)
        assertEquals(403, call("PATCH", path, viewer, body, mapOf("If-Match" to (v + 1).toString())).status)
        assertEquals(404, call("PATCH", "/api/v1/clients/${UUID.randomUUID()}", staff, body, mapOf("If-Match" to "0")).status)
        val next = (v + 1).toString()
        fun refuse(json: String, field: String, code: String) {
            val r = call("PATCH", path, staff, json, mapOf("If-Match" to next))
            assertEquals(422, r.status, r.text)
            assertTrue(r.text.contains("\"field\":\"$field\"") && r.text.contains("\"code\":\"$code\""), r.text)
        }
        refuse("""{"phone":"${"1".repeat(41)}"}""", "phone", "too_long")
        refuse("""{"weddingDate":"next spring"}""", "weddingDate", "invalid")
        refuse("""{"weddingDate":"2027-02-30"}""", "weddingDate", "invalid")
        refuse("""{"source":"Billboard"}""", "source", "invalid")
        refuse("""{"note":"${"n".repeat(2001)}"}""", "note", "too_long")
        refuse("""{"city":"Lis\nbon"}""", "city", "invalid")
        // blanks clear
        val cleared = call("PATCH", path, staff, "{}", mapOf("If-Match" to next))
        assertEquals(200, cleared.status, cleared.text)
        assertTrue(cleared.text.contains("\"phone\":null") && cleared.text.contains("\"source\":null"), cleared.text)
    }

    @Test
    fun `a Client message on a Closed inquiry reopens it as new and unread, newest first, and the count rises`() {
        val staff = person(DefaultRoles.STAFF)
        val admin = admin()
        val a = make(staff)
        val b = make(staff)
        assertEquals(200, setStatus(admin, a.id, "closed").status)
        call("POST", "/api/v1/inquiries/${a.id}/read", staff)
        call("POST", "/api/v1/inquiries/${b.id}/read", staff)
        val count = { num(call("GET", "/api/v1/inquiries/count", staff).text, "count") }
        val before = count()
        tx.executeWithoutResult { state.reopenOnClientMessage(em.find(Inquiry::class.java, UUID.fromString(a.id))!!) }
        val detail = call("GET", "/api/v1/inquiries/${a.id}", staff).text
        assertEquals("new", str(detail, "status"))
        assertTrue(detail.contains("\"unread\":true"), detail)
        assertEquals(before + 1, count())
        val ids = Regex(""""id":"([0-9a-f-]{36})"""").findAll(call("POST", "/api/v1/inquiries/query", staff, "{}").text).map { it.groupValues[1] }.toList()
        assertTrue(ids.indexOf(a.id) in 0 until ids.indexOf(b.id), ids.toString())
        // an open one stays what it is, but is unread and newest again
        tx.executeWithoutResult { state.reopenOnClientMessage(em.find(Inquiry::class.java, UUID.fromString(b.id))!!) }
        assertEquals("new", str(call("GET", "/api/v1/inquiries/${b.id}", staff).text, "status"))
    }
}
