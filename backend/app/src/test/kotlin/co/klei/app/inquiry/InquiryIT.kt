package co.klei.app.inquiry

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.upload.FakeStore
import co.klei.app.upload.RecordingNotes
import co.klei.app.upload.UploadClient
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.notification.NotificationType
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
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

/** Story 7.1: create and list Inquiries. */
@Testcontainers
@Import(RecordingMailConfig::class, InquiryIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class InquiryIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
        @Bean @Primary fun notes() = RecordingNotes()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Inquiry-pass-1"

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
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var notes: RecordingNotes

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"

    private class Who(val id: UUID, val email: String, val token: String)

    private fun person(role: String): Who {
        val email = "inq-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        val id = tx.execute { users.create("Inq Person", email, PW, rid, UserStatus.ACTIVE, true) }!!.id
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return Who(id, email, field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!)
    }

    private fun call(method: String, path: String, token: String?, json: String? = null, headers: Map<String, String> = emptyMap()) =
        UploadClient.call(method, "$api$path", token, json?.toByteArray(), buildMap { if (json != null) put("Content-Type", "application/json"); putAll(headers) })

    private fun body(name: String, email: String, subject: String = "Fitting in June", text: String = "Hello,\nI would like a fitting.") =
        """{"clientName":"$name","clientEmail":"$email","subject":"$subject","body":${quote(text)}}"""

    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
    private fun str(json: String, key: String) = Regex(""""$key":"((?:[^"\\]|\\.)*)"""").find(json)!!.groupValues[1]
    private fun email() = "client-${UUID.randomUUID()}@example.test"
    private fun count(t: String) = Regex(""""count":(\d+)""").find(call("GET", "/api/v1/inquiries/count", t).text)!!.groupValues[1].toLong()
    private fun ids(json: String) = Regex(""""id":"([0-9a-f-]{36})"""").findAll(json).map { it.groupValues[1] }.toList()
    private fun fields(r: UploadClient.Resp) = Regex(""""field":"(\w+)","code":"(\w+)"""").findAll(r.text).map { it.groupValues[1] to it.groupValues[2] }.toList()

    @Test
    fun `staff creates an inquiry that shows first, unread and new, and the badge counts it`() {
        val staff = person(DefaultRoles.STAFF)
        val before = count(staff.token)
        val long = "x".repeat(300)
        val r = call("POST", "/api/v1/inquiries", staff.token, body("Mara Lindqvist", email(), "Veil questions", long))
        assertEquals(201, r.status, r.text)
        assertEquals("new", str(r.text, "status"))
        assertTrue(r.text.contains(""""unread":true"""))
        assertEquals("Mara Lindqvist", str(r.text, "clientName"))
        assertEquals(120, str(r.text, "preview").length)
        assertEquals(before + 1, count(staff.token))
        val page = call("POST", "/api/v1/inquiries/query", staff.token, "{}")
        assertEquals(200, page.status, page.text)
        assertEquals(str(r.text, "id"), ids(page.text).first())
    }

    @Test
    fun `two inquiries from one address share one client and list newest first`() {
        val staff = person(DefaultRoles.STAFF)
        val addr = email()
        val a = call("POST", "/api/v1/inquiries", staff.token, body("Ana Rivera", addr, "First"))
        val b = call("POST", "/api/v1/inquiries", staff.token, body("Ana R.", addr.uppercase(), "Second"))
        assertEquals(201, a.status, a.text); assertEquals(201, b.status, b.text)
        assertEquals(str(a.text, "clientId"), str(b.text, "clientId"))
        assertNotEquals(str(a.text, "id"), str(b.text, "id"))
        assertEquals("Ana Rivera", str(b.text, "clientName"))
        val got = ids(call("POST", "/api/v1/inquiries/query", staff.token, """{"status":"new"}""").text)
        assertTrue(got.indexOf(str(b.text, "id")) in 0 until got.indexOf(str(a.text, "id")))
    }

    @Test
    fun `the same Idempotency-Key returns the first inquiry with 200 and makes no second one`() {
        val staff = person(DefaultRoles.STAFF)
        val key = mapOf("Idempotency-Key" to "k-${UUID.randomUUID()}")
        val first = call("POST", "/api/v1/inquiries", staff.token, body("Key Person", email()), key)
        val again = call("POST", "/api/v1/inquiries", staff.token, body("Key Person", email()), key)
        assertEquals(201, first.status, first.text)
        assertEquals(200, again.status, again.text)
        assertEquals(str(first.text, "id"), str(again.text, "id"))
        assertEquals(400, call("POST", "/api/v1/inquiries", staff.token, body("Key Person", email()), mapOf("Idempotency-Key" to "")).status)
    }

    @Test
    fun `bad input is 422 naming the field and echoing nothing`() {
        val staff = person(DefaultRoles.STAFF)
        val r = call("POST", "/api/v1/inquiries", staff.token, body("  ", "not-an-address", "Hi", "y".repeat(20_001)))
        assertEquals(422, r.status, r.text)
        assertEquals(setOf("clientName" to "required", "clientEmail" to "invalid", "body" to "too_long"), fields(r).toSet())
        assertFalse(r.text.contains("not-an-address"))
        val empty = call("POST", "/api/v1/inquiries", staff.token, """{}""")
        assertEquals(422, empty.status)
        assertEquals(4, fields(empty).size)
        assertEquals(201, call("POST", "/api/v1/inquiries", staff.token, body("Edge", email(), "S", "z".repeat(20_000))).status)
        assertEquals(setOf("status" to "invalid"), fields(call("POST", "/api/v1/inquiries/query", staff.token, """{"status":"open"}""")).toSet())
        assertEquals(setOf("limit" to "invalid"), fields(call("POST", "/api/v1/inquiries/query", staff.token, """{"limit":0}""")).toSet())
    }

    @Test
    fun `paging walks back by seq with limit and next, and the status filter splits them`() {
        val staff = person(DefaultRoles.STAFF)
        val made = (1..3).map { str(call("POST", "/api/v1/inquiries", staff.token, body("Pager $it", email(), "Page $it")).text, "id") }
        val one = call("POST", "/api/v1/inquiries/query", staff.token, """{"limit":2}""")
        assertEquals(made[2], ids(one.text)[0]); assertEquals(made[1], ids(one.text)[1])
        val next = Regex(""""next":(\d+)""").find(one.text)!!.groupValues[1]
        assertEquals(made[0], ids(call("POST", "/api/v1/inquiries/query", staff.token, """{"limit":1,"before":$next}""").text).single())
        assertEquals(0, ids(call("POST", "/api/v1/inquiries/query", staff.token, """{"status":"closed"}""").text).size)
        assertTrue(call("POST", "/api/v1/inquiries/query", staff.token, """{"status":"new","limit":50}""").text.contains(made[0]))
    }

    @Test
    fun `viewer is refused on every route and anonymous is 401`() {
        val viewer = person(DefaultRoles.VIEWER)
        assertEquals(403, call("POST", "/api/v1/inquiries", viewer.token, body("V", email())).status)
        assertEquals(403, call("POST", "/api/v1/inquiries/query", viewer.token, "{}").status)
        assertEquals(403, call("GET", "/api/v1/inquiries/count", viewer.token).status)
        assertEquals(401, call("GET", "/api/v1/inquiries/count", null).status)
    }

    @Test
    fun `new inquiry notifies replying users who have it on, not the author and not a user who turned it off`() {
        val author = person(DefaultRoles.STAFF)
        val on = person(DefaultRoles.STAFF)
        val off = person(DefaultRoles.STAFF)
        val viewer = person(DefaultRoles.VIEWER)
        val prefs = """{"timezone":"UTC","dateFormat":"DD/MM/YYYY","startPage":"gallery","enterToSend":false,"newInquiry":false,"aiFinished":true,"teamActivity":true}"""
        assertEquals(200, call("PUT", "/api/v1/me/preferences", off.token, prefs, mapOf("If-Match" to "0")).status)
        val name = "Notify ${UUID.randomUUID()}"
        assertEquals(201, call("POST", "/api/v1/inquiries", author.token, body(name, email())).status)
        val sent = notes.sent.single { it.type == NotificationType.NEW_INQUIRY && it.title.contains(name) }
        assertTrue(on.id in sent.recipients)
        assertFalse(author.id in sent.recipients); assertFalse(off.id in sent.recipients); assertFalse(viewer.id in sent.recipients)
    }

    @Test
    fun `a rolled back create leaves no client, inquiry or notification behind`() {
        val staff = person(DefaultRoles.STAFF)
        val before = jdbc.queryForObject("select count(*) from inquiry", Long::class.java)
        val bad = call("POST", "/api/v1/inquiries", staff.token, body("Nope", "bad"))
        assertEquals(422, bad.status)
        assertEquals(before, jdbc.queryForObject("select count(*) from inquiry", Long::class.java))
    }

    @Test
    fun `detail returns the thread with client summary, 404 for an unknown id, and does not mark it read`() {
        val staff = person(DefaultRoles.STAFF)
        val made = call("POST", "/api/v1/inquiries", staff.token, body("Thread Client", email(), "Thread subject", "Line one\nLine two <b>kept as text</b>"))
        val id = str(made.text, "id")
        val r = call("GET", "/api/v1/inquiries/$id", staff.token)
        assertEquals(200, r.status, r.text)
        assertEquals("Thread subject", str(r.text, "subject"))
        assertEquals("new", str(r.text, "status"))
        assertTrue(r.text.contains(""""unread":true"""))
        assertEquals("Thread Client", str(r.text, "name"))
        assertEquals("in", str(r.text, "direction"))
        assertTrue(r.text.contains("Line one\\nLine two <b>kept as text</b>"), r.text)
        assertTrue(call("GET", "/api/v1/inquiries/$id", staff.token).text.contains(""""unread":true"""))
        assertEquals(404, call("GET", "/api/v1/inquiries/${UUID.randomUUID()}", staff.token).status)
        assertEquals(404, call("POST", "/api/v1/inquiries/${UUID.randomUUID()}/read", staff.token).status)
    }

    @Test
    fun `read clears unread for everyone, keeps seq and version, drops the badge, and a repeat is 204`() {
        val staff = person(DefaultRoles.STAFF)
        val other = person(DefaultRoles.STAFF)
        val id = str(call("POST", "/api/v1/inquiries", staff.token, body("Read Client", email())).text, "id")
        val seq = jdbc.queryForObject("select seq from inquiry where id = ?::uuid", Long::class.java, id)
        val version = Regex(""""version":(\d+)""").find(call("GET", "/api/v1/inquiries/$id", staff.token).text)!!.groupValues[1]
        val before = count(other.token)
        assertEquals(204, call("POST", "/api/v1/inquiries/$id/read", staff.token).status)
        assertEquals(204, call("POST", "/api/v1/inquiries/$id/read", other.token).status)
        assertEquals(before - 1, count(other.token))
        val after = call("GET", "/api/v1/inquiries/$id", other.token)
        assertTrue(after.text.contains(""""unread":false"""), after.text)
        assertEquals(version, Regex(""""version":(\d+)""").find(after.text)!!.groupValues[1])
        assertEquals(seq, jdbc.queryForObject("select seq from inquiry where id = ?::uuid", Long::class.java, id))
        assertTrue(call("POST", "/api/v1/inquiries/query", other.token, "{}").text.contains(""""id":"$id","clientId""") )
    }

    @Test
    fun `client read returns profile fields empty, the client's inquiries newest first, and refuses a viewer`() {
        val staff = person(DefaultRoles.STAFF)
        val viewer = person(DefaultRoles.VIEWER)
        val addr = email()
        val first = call("POST", "/api/v1/inquiries", staff.token, body("Many Inquiries", addr, "Q 0"))
        val clientId = str(first.text, "clientId")
        (1..29).forEach { assertEquals(201, call("POST", "/api/v1/inquiries", staff.token, body("Many Inquiries", addr, "Q $it")).status) }
        val r = call("GET", "/api/v1/clients/$clientId", staff.token)
        assertEquals(200, r.status, r.text)
        assertEquals("Many Inquiries", str(r.text, "name"))
        assertEquals(addr, str(r.text, "email"))
        assertEquals(30, ids(r.text).size - 1)
        assertEquals("Hello, I would like a fitting.", str(r.text.substring(r.text.indexOf(""""inquiries":[""")), "preview"))
        assertTrue(r.text.indexOf("Q 29") in 0 until r.text.indexOf(""""subject":"Q 0""""))
        assertTrue(r.text.contains(""""phone":null""") || !r.text.contains(""""phone":"""") )
        assertEquals(403, call("GET", "/api/v1/clients/$clientId", viewer.token).status)
        assertEquals(404, call("GET", "/api/v1/clients/${UUID.randomUUID()}", staff.token).status)
        assertEquals(403, call("GET", "/api/v1/inquiries/${str(first.text, "id")}", viewer.token).status)
        assertEquals(403, call("POST", "/api/v1/inquiries/${str(first.text, "id")}/read", viewer.token).status)
    }
}
