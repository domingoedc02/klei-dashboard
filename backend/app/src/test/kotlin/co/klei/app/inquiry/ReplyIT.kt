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
import java.net.ServerSocket
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 7.3: drafts, attachments, the reply and its mail, retry. */
@Testcontainers
@Import(RecordingMailConfig::class, ReplyIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class ReplyIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
        @Bean @Primary fun notes() = RecordingNotes()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Reply-pass-1"

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
    @Autowired lateinit var mail: RecordingMail
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"

    private class Who(val id: UUID, val token: String)
    private class Made(val id: String, val client: String)

    private fun person(role: String): Who {
        val email = "rep-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        val id = tx.execute { users.create("Rep Person", email, PW, rid, UserStatus.ACTIVE, true) }!!.id
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return Who(id, field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!)
    }

    private fun call(method: String, path: String, token: String?, json: String? = null, headers: Map<String, String> = emptyMap()) =
        UploadClient.call(method, "$api$path", token, json?.toByteArray(), buildMap { if (json != null) put("Content-Type", "application/json"); putAll(headers) })

    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
    private fun str(json: String, key: String) = Regex(""""$key":"((?:[^"\\]|\\.)*)"""").find(json)!!.groupValues[1]
    private fun make(who: Who, subject: String = "Fitting in June"): Made {
        val client = "client-${UUID.randomUUID()}@example.test"
        val r = call("POST", "/api/v1/inquiries", who.token, """{"clientName":"Mara Lindqvist","clientEmail":"$client","subject":"$subject","body":"Hello"}""")
        assertEquals(201, r.status, r.text)
        return Made(str(r.text, "id"), client)
    }

    private fun reply(who: Who, inquiry: Made, html: String, key: String = UUID.randomUUID().toString()) =
        call("POST", "/api/v1/inquiries/${inquiry.id}/reply", who.token, """{"body":${quote(html)}}""", mapOf("Idempotency-Key" to key))

    private fun sentTo(client: String) = mail.replies.filter { it.to == client }

    @Test
    fun `a reply is mailed once, marks the inquiry replied, lists first, drops the draft and audits without content`() {
        val staff = person(DefaultRoles.STAFF)
        val a = make(staff, "Veil questions")
        val b = make(staff)
        val put = call("PUT", "/api/v1/inquiries/${a.id}/draft", staff.token, """{"body":"<div>work in progress</div>"}""")
        assertEquals(200, put.status, put.text)
        val key = UUID.randomUUID().toString()
        val text = "Thank you, we would love to see you.\nPlease come on Friday."
        val r = reply(staff, a, "<div>${text.replace("\n", "<br>")}</div>", key)
        assertEquals(201, r.status, r.text)
        assertEquals("sent", str(r.text, "mailState"))
        assertEquals("out", str(r.text, "direction"))
        assertEquals("Rep Person", str(r.text, "author"))
        assertEquals(1, sentTo(a.client).size)
        assertEquals("Veil questions", sentTo(a.client).single().subject)
        assertTrue(sentTo(a.client).single().text.contains("Please come on Friday."))
        // the same key again: the first Message, nothing more sent
        val again = reply(staff, a, "<div>other text</div>", key)
        assertEquals(200, again.status, again.text)
        assertEquals(str(r.text, "id"), str(again.text, "id"))
        assertEquals(1, sentTo(a.client).size)
        // status, order, draft
        val detail = call("GET", "/api/v1/inquiries/${a.id}", staff.token)
        assertEquals("replied", str(detail.text, "status"))
        val page = call("POST", "/api/v1/inquiries/query", staff.token, "{}")
        val ids = Regex(""""id":"([0-9a-f-]{36})"""").findAll(page.text).map { it.groupValues[1] }.toList()
        assertTrue(ids.indexOf(a.id) in 0 until ids.indexOf(b.id), page.text)
        assertEquals("", str(call("GET", "/api/v1/inquiries/${a.id}/draft", staff.token).text, "body"))
        // audit: the action, never the text
        val entries = tx.execute { audit.all().filter { it.action == "reply_sent" } }!!
        assertTrue(entries.isNotEmpty())
        assertTrue(entries.none { it.detail?.contains("Friday") == true })
    }

    @Test
    fun `a reply needs an idempotency key, text, and an open inquiry, and a viewer cannot reply`() {
        val staff = person(DefaultRoles.STAFF)
        val viewer = person(DefaultRoles.VIEWER)
        val q = make(staff)
        assertEquals(400, call("POST", "/api/v1/inquiries/${q.id}/reply", staff.token, """{"body":"<div>x</div>"}""").status)
        val blank = reply(staff, q, "<div> <br></div>")
        assertEquals(422, blank.status, blank.text)
        assertTrue(blank.text.contains("\"field\":\"body\"") && blank.text.contains("\"code\":\"required\""), blank.text)
        val long = reply(staff, q, "a".repeat(100_001))
        assertEquals(422, long.status, long.text)
        assertTrue(long.text.contains("too_long"), long.text)
        assertEquals(403, reply(viewer, q, "<div>x</div>").status)
        assertEquals(404, reply(staff, Made(UUID.randomUUID().toString(), ""), "<div>x</div>").status)
        tx.executeWithoutResult { em.find(Inquiry::class.java, UUID.fromString(q.id))!!.status = InquiryStatus.CLOSED }
        assertEquals(409, reply(staff, q, "<div>x</div>").status)
        assertEquals(0, sentTo(q.client).size)
    }

    @Test
    fun `a mail the server does not take leaves the reply recorded as failed and retry sends it once`() {
        val staff = person(DefaultRoles.STAFF)
        val q = make(staff)
        mail.failReplies = true
        val r = try { reply(staff, q, "<div>Hello again</div>") } finally { mail.failReplies = false }
        assertEquals(201, r.status, r.text)
        assertEquals("failed", str(r.text, "mailState"))
        assertEquals(0, sentTo(q.client).size)
        assertEquals("replied", str(call("GET", "/api/v1/inquiries/${q.id}", staff.token).text, "status"))
        val id = str(r.text, "id")
        val retried = call("POST", "/api/v1/messages/$id/retry", staff.token)
        assertEquals(200, retried.status, retried.text)
        assertEquals("sent", str(retried.text, "mailState"))
        assertEquals(1, sentTo(q.client).size)
        assertEquals(409, call("POST", "/api/v1/messages/$id/retry", staff.token).status)
        assertEquals(404, call("POST", "/api/v1/messages/${UUID.randomUUID()}/retry", staff.token).status)
        assertEquals(1, sentTo(q.client).size)
    }

    @Test
    fun `a draft is private to its writer, saves clean html, and discarding twice is fine`() {
        val staff = person(DefaultRoles.STAFF)
        val other = person(DefaultRoles.STAFF)
        val q = make(staff)
        val saved = call("PUT", "/api/v1/inquiries/${q.id}/draft", staff.token, """{"body":"<b>bold</b><script>alert(1)</script>"}""")
        assertEquals(200, saved.status, saved.text)
        assertTrue(saved.text.contains("updatedAt"))
        val mine = call("GET", "/api/v1/inquiries/${q.id}/draft", staff.token)
        assertTrue(mine.text.contains("<b>bold</b>") && !mine.text.contains("script"), mine.text)
        assertEquals("", str(call("GET", "/api/v1/inquiries/${q.id}/draft", other.token).text, "body"))
        assertEquals(422, call("PUT", "/api/v1/inquiries/${q.id}/draft", staff.token, """{"body":${quote("a".repeat(100_001))}}""").status)
        assertEquals(204, call("DELETE", "/api/v1/inquiries/${q.id}/draft", staff.token).status)
        assertEquals(204, call("DELETE", "/api/v1/inquiries/${q.id}/draft", staff.token).status)
        assertEquals("", str(call("GET", "/api/v1/inquiries/${q.id}/draft", staff.token).text, "body"))
        // a blank save is no draft
        call("PUT", "/api/v1/inquiries/${q.id}/draft", staff.token, """{"body":"<div>x</div>"}""")
        assertFalse(call("PUT", "/api/v1/inquiries/${q.id}/draft", staff.token, """{"body":"<div><br></div>"}""").text.contains("T"))
        assertEquals(404, call("GET", "/api/v1/inquiries/${UUID.randomUUID()}/draft", staff.token).status)
    }

    @Test
    fun `an attachment travels with the reply, shows on the thread and its bytes reach the mail`() {
        val staff = person(DefaultRoles.STAFF)
        val q = make(staff)
        val bytes = "price list ${UUID.randomUUID()}".toByteArray()
        val up = UploadClient.attachment(api, staff.token, q.id, "prices.txt", bytes, "att-1-${UUID.randomUUID()}", "text/plain")
        assertEquals(201, up.status, up.text)
        assertEquals("prices.txt", str(up.text, "name"))
        val draft = call("GET", "/api/v1/inquiries/${q.id}/draft", staff.token)
        assertTrue(draft.text.contains("prices.txt"), draft.text)
        val r = reply(staff, q, "<div>See the list.</div>")
        assertEquals(201, r.status, r.text)
        assertTrue(r.text.contains("prices.txt"), r.text)
        val sent = sentTo(q.client).single()
        assertEquals(listOf("prices.txt"), sent.attachments.map { it.name })
        assertContentEquals(bytes, sent.attachments.single().bytes)
        assertTrue(call("GET", "/api/v1/inquiries/${q.id}", staff.token).text.contains("prices.txt"))
        assertFalse(call("GET", "/api/v1/inquiries/${q.id}/draft", staff.token).text.contains("prices.txt"))
    }

    @Test
    fun `attachments need a key, repeat by key, stop at the limits, and only their owner removes them`() {
        val staff = person(DefaultRoles.STAFF)
        val other = person(DefaultRoles.STAFF)
        val q = make(staff)
        assertEquals(400, UploadClient.attachment(api, staff.token, q.id, "a.txt", byteArrayOf(1), null).status)
        assertEquals(422, UploadClient.attachment(api, staff.token, q.id, "a.txt", ByteArray(0), "e-${UUID.randomUUID()}").status)
        val key = "k-${UUID.randomUUID()}"
        val first = UploadClient.attachment(api, staff.token, q.id, "..\\x/../evil name.txt", byteArrayOf(1, 2, 3), key)
        assertEquals(201, first.status, first.text)
        assertEquals("evil name.txt", str(first.text, "name"))
        val repeat = UploadClient.attachment(api, staff.token, q.id, "other.txt", byteArrayOf(9), key)
        assertEquals(str(first.text, "id"), str(repeat.text, "id"))
        assertEquals(404, call("DELETE", "/api/v1/inquiries/${q.id}/attachments/${str(first.text, "id")}", other.token).status)
        assertEquals(204, call("DELETE", "/api/v1/inquiries/${q.id}/attachments/${str(first.text, "id")}", staff.token).status)
        assertEquals(404, call("DELETE", "/api/v1/inquiries/${q.id}/attachments/${str(first.text, "id")}", staff.token).status)
        // ten files, then the eleventh stops
        repeat(10) { assertEquals(201, UploadClient.attachment(api, staff.token, q.id, "f$it.bin", byteArrayOf(it.toByte()), "n$it-${UUID.randomUUID()}").status) }
        assertEquals(413, UploadClient.attachment(api, staff.token, q.id, "f11.bin", byteArrayOf(1), "n11-${UUID.randomUUID()}").status)
        assertEquals(204, call("DELETE", "/api/v1/inquiries/${q.id}/draft", staff.token).status)
        // size: 8 + 8 MB fit, the third 8 MB goes over 20 MB
        val big = ByteArray(8 * 1024 * 1024) { 7 }
        assertEquals(201, UploadClient.attachment(api, staff.token, q.id, "b1.bin", big, "b1-${UUID.randomUUID()}").status)
        assertEquals(201, UploadClient.attachment(api, staff.token, q.id, "b2.bin", big, "b2-${UUID.randomUUID()}").status)
        assertEquals(413, UploadClient.attachment(api, staff.token, q.id, "b3.bin", big, "b3-${UUID.randomUUID()}").status)
    }

    @Test
    fun `script, handler and javascript link never reach the stored reply or the mail`() {
        val staff = person(DefaultRoles.STAFF)
        val q = make(staff)
        val r = reply(staff, q, """<b onclick="x()">hi</b><script>alert(1)</script><a href="javascript:alert(1)">go</a><img src=x onerror=alert(1)>""")
        assertEquals(201, r.status, r.text)
        for (bad in listOf("<script", "onclick", "javascript:", "<img", "onerror")) {
            assertFalse(r.text.contains(bad, ignoreCase = true), "$bad in ${r.text}")
            assertFalse(sentTo(q.client).single().html.contains(bad, ignoreCase = true), "$bad in mail")
        }
        assertTrue(sentTo(q.client).single().html.contains("<b>hi</b>"))
    }
}
