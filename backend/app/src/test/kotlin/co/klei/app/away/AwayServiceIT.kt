package co.klei.app.away

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
import co.klei.core.mail.MailTemplate
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.AfterEach
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
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 11.12: the settings endpoint, its rules and audit, and the one mail per client per closure window. */
@Testcontainers
@Import(RecordingMailConfig::class, AwayServiceIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class AwayServiceIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
        @Bean @Primary fun notes() = RecordingNotes()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Away-pass-1"
        private const val TEXT = "We are closed and will write back soon."

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
    @Autowired lateinit var away: AwayService
    @Autowired lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private class Who(val id: UUID, val token: String)

    @AfterEach fun reset() { away.clock = Clock.systemUTC(); mail.failSends = false }

    private fun person(role: String): Who {
        val email = "away-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        val id = tx.execute { users.create("Away Person", email, PW, rid, UserStatus.ACTIVE, true) }!!.id
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return Who(id, field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!)
    }

    private fun call(method: String, path: String, token: String?, json: String? = null, headers: Map<String, String> = emptyMap()) =
        UploadClient.call(method, "$api$path", token, json?.toByteArray(), buildMap { if (json != null) put("Content-Type", "application/json"); putAll(headers) })

    private fun body(on: Boolean, message: String, schedule: String) = """{"enabled":$on,"message":"$message","schedule":$schedule}"""
    private fun weekly(vararg days: String) = """{"mode":"weekly","days":[${days.joinToString(",") { "\"$it\"" }}]}"""
    private fun put(who: Who, json: String, version: Long) = call("PUT", "/api/v1/admin/away", who.token, json, mapOf("If-Match" to version.toString()))
    private fun version(text: String) = Regex(""""version":(\d+)""").find(text)!!.groupValues[1].toLong()

    private fun write(inquirer: String, name: String = "Mara Lindqvist", key: String = UUID.randomUUID().toString()): String {
        val admin = person(DefaultRoles.STAFF)
        val r = call("POST", "/api/v1/inquiries", admin.token, """{"clientName":"$name","clientEmail":"$inquirer","subject":"Hello","body":"A private question"}""", mapOf("Idempotency-Key" to key))
        assertEquals(201, r.status, r.text)
        return inquirer
    }
    private fun awayTo(client: String) = mail.sent.filter { it.template == MailTemplate.AWAY && it.to == client }
    private fun at(s: String) { away.clock = Clock.fixed(Instant.parse(s), ZoneOffset.UTC) }

    @Test
    fun `only an Admin reads or writes, a first save needs version 0 and a stale one is 409`() {
        val admin = person(DefaultRoles.ADMIN)
        for (role in listOf(DefaultRoles.STAFF, DefaultRoles.VIEWER)) {
            val p = person(role)
            assertEquals(403, call("GET", "/api/v1/admin/away", p.token).status)
            assertEquals(403, put(p, body(false, TEXT, weekly("sat")), 0).status)
        }
        val fresh = call("GET", "/api/v1/admin/away", admin.token)
        assertEquals(200, fresh.status, fresh.text)
        assertTrue(fresh.text.contains(""""schedule":{"""), fresh.text) // one shared row: other tests may have saved already
        val saved = put(admin, body(true, TEXT, weekly("sat", "sun")), version(fresh.text))
        assertEquals(200, saved.status, saved.text)
        assertTrue(saved.text.contains(TEXT) && saved.text.contains(""""zone":"UTC""""), saved.text)
        assertEquals(409, put(admin, body(true, TEXT, weekly("sat")), 0).status)
        val next = put(admin, body(true, "$TEXT Again.", weekly("sat")), version(saved.text))
        assertEquals(200, next.status, next.text)
        assertEquals(version(saved.text) + 1, version(next.text))
        assertEquals(400, call("PUT", "/api/v1/admin/away", admin.token, body(true, TEXT, weekly("sat"))).status)
    }

    @Test
    fun `the schedule and message rules are enforced on the server`() {
        val admin = person(DefaultRoles.ADMIN)
        val v = version(call("GET", "/api/v1/admin/away", admin.token).text)
        fun bad(json: String, field: String, code: String) {
            val r = put(admin, json, v)
            assertEquals(422, r.status, "$json -> ${r.text}")
            assertTrue(r.text.contains("\"$field\"") && r.text.contains("\"$code\""), "$json -> ${r.text}")
        }
        bad(body(true, "  ", weekly("sat")), "message", "required")
        bad(body(true, "x".repeat(2001), weekly("sat")), "message", "too_long")
        bad(body(true, TEXT, """{"mode":"once"}"""), "start", "required")
        bad(body(true, TEXT, """{"mode":"once","start":"2026-11-27","end":"2026-11-26"}"""), "end", "before_start")
        bad(body(true, TEXT, """{"mode":"once","start":"26/11/2026"}"""), "start", "invalid")
        bad(body(true, TEXT, weekly()), "days", "required")
        bad(body(true, TEXT, weekly("someday")), "days", "invalid")
        bad(body(true, TEXT, """{"mode":"daily","from":"18:00","to":"18:00"}"""), "to", "must_differ")
        bad(body(true, TEXT, """{"mode":"daily","from":"25:00","to":"09:00"}"""), "from", "invalid")
        bad(body(true, TEXT, """{"mode":"yearly"}"""), "mode", "invalid")
        // Off needs no message, and a bad schedule is still refused.
        assertEquals(200, put(admin, body(false, "", weekly("sat")), v).status)
    }

    @Test
    fun `a change is audited by field name and never by message text`() {
        val admin = person(DefaultRoles.ADMIN)
        val v = version(call("GET", "/api/v1/admin/away", admin.token).text)
        val secret = "Audit-me-not-${UUID.randomUUID()}"
        val a = put(admin, body(true, secret, weekly("sat")), v)
        assertEquals(200, a.status, a.text)
        assertEquals(200, put(admin, body(true, secret, weekly("sun")), version(a.text)).status)
        val entries = tx.execute { audit.all().filter { it.action == "away_changed" } }!!
        assertTrue(entries.size >= 2)
        assertTrue(entries.none { it.detail?.contains(secret) == true })
        assertTrue(entries.any { it.detail == "changed: schedule" })
    }

    @Test
    fun `one away mail per client per window, none outside, none when off, and the zone is the Admin's`() {
        val admin = person(DefaultRoles.ADMIN)
        val v = version(call("GET", "/api/v1/admin/away", admin.token).text)
        val client = "client-${UUID.randomUUID()}@example.test"

        at("2026-11-11T12:00:00Z") // a Wednesday
        val on = put(admin, body(true, TEXT, weekly("sat", "sun")), v)
        assertEquals(200, on.status, on.text)
        write(client)
        assertEquals(0, awayTo(client).size, "open on Wednesday")

        at("2026-11-14T10:00:00Z") // Saturday
        write(client, key = "k1")
        assertEquals(1, awayTo(client).size)
        val sent = awayTo(client).single()
        assertEquals(mapOf("body" to TEXT, "first" to "Mara"), sent.model)
        write(client, key = "k2")
        at("2026-11-15T10:00:00Z") // Sunday, same closure
        write(client, key = "k3")
        assertEquals(1, awayTo(client).size, "second inquiry in the same window")

        at("2026-11-21T10:00:00Z") // next Saturday, a new window
        write(client, key = "k4")
        assertEquals(2, awayTo(client).size)
        val rows = tx.execute { em.createQuery("select count(s) from AwaySent s", Long::class.javaObjectType).singleResult }!!
        assertTrue(rows >= 2, "each send is recorded with its window")

        // Switched off: nothing, even inside a window.
        val off = put(admin, body(false, TEXT, weekly("sat", "sun")), version(on.text))
        assertEquals(200, off.status, off.text)
        val other = "client-${UUID.randomUUID()}@example.test"
        write(other)
        assertEquals(0, awayTo(other).size)

        // The window is read in the Admin's zone: 03:30Z on Saturday is still Friday evening in New York.
        val prefs = call("PUT", "/api/v1/me/preferences", admin.token, """{"timezone":"America/New_York","dateFormat":"DD/MM/YYYY","startPage":"gallery","enterToSend":true,"newInquiry":true,"aiFinished":true,"teamActivity":true}""", mapOf("If-Match" to "0"))
        assertEquals(200, prefs.status, prefs.text)
        val ny = put(admin, body(true, TEXT, weekly("sat")), version(off.text))
        assertTrue(ny.text.contains("America/New_York"), ny.text)
        at("2026-11-28T03:30:00Z")
        val late = "client-${UUID.randomUUID()}@example.test"
        write(late)
        assertEquals(0, awayTo(late).size, "Friday 22:30 in New York")
        at("2026-11-28T06:00:00Z")
        write("client-${UUID.randomUUID()}@example.test", "Ana Ruiz").let { assertEquals(0, awayTo(late).size); assertEquals(1, awayTo(it).size) }
    }

    @Test
    fun `a refused mail is not retried and never fails the inquiry`() {
        val admin = person(DefaultRoles.ADMIN)
        val v = version(call("GET", "/api/v1/admin/away", admin.token).text)
        assertEquals(200, put(admin, body(true, TEXT, weekly("mon", "tue", "wed", "thu", "fri", "sat", "sun")), v).status)
        val client = "client-${UUID.randomUUID()}@example.test"
        mail.failSends = true
        write(client, key = "f1")
        mail.failSends = false
        write(client, key = "f2")
        assertFalse(awayTo(client).isNotEmpty(), "the window was claimed by the failed attempt; no retry")
    }
}
