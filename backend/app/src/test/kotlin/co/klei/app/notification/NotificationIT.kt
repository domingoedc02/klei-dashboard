package co.klei.app.notification

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.upload.FakeStore
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
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 8.1: the bell. Uses the real [NotificationService]; each test makes its own Users so counts never mix. */
@Testcontainers
@Import(RecordingMailConfig::class, NotificationIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class NotificationIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Bell-pass-1"

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
    @Autowired lateinit var service: NotificationService

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private val client get() = AuthWebClient("http://127.0.0.1:$authPort", api)

    private class Person(val id: UUID, val email: String, val token: String)

    private fun person(role: String = DefaultRoles.STAFF, status: UserStatus = UserStatus.ACTIVE): Person {
        val email = "bell-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        val id = tx.execute { users.create("Bell Person", email, PW, rid, status, true).id }!!
        val c = client
        return Person(id, email, if (status == UserStatus.ACTIVE) field(c.exchange(c.signIn(email, PW)).body, "accessToken")!! else "")
    }

    private fun admin() = field(client.let { it.exchange(it.signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)).body }, "accessToken")!!

    private fun call(method: String, path: String, token: String?, json: String? = null, version: Long? = null) =
        UploadClient.call(
            method, "$api$path", token, json?.toByteArray(),
            buildMap { if (json != null) put("Content-Type", "application/json"); if (version != null) put("If-Match", version.toString()) },
        )

    private fun bell(p: Person) = call("GET", "/api/v1/notifications", p.token)
    private fun titles(p: Person) = Regex(""""title":"((?:[^"\\]|\\.)*)"""").findAll(bell(p).text).map { it.groupValues[1] }.toList()
    private fun rows(p: Person) = jdbc.queryForObject("select count(*) from notification where user_id = ?", Long::class.java, p.id)!!

    private fun prefs(p: Person, inquiry: Boolean = true, ai: Boolean = true, team: Boolean = true) {
        val json = """{"timezone":null,"dateFormat":"DD/MM/YYYY","startPage":"gallery","enterToSend":false,"newInquiry":$inquiry,"aiFinished":$ai,"teamActivity":$team}"""
        assertEquals(200, call("PUT", "/api/v1/me/preferences", p.token, json, 0).status)
    }

    private fun inquire(token: String, name: String = "Mara Lindqvist"): String {
        val r = call("POST", "/api/v1/inquiries", token, """{"clientName":"$name","clientEmail":"c-${UUID.randomUUID()}@example.test","subject":"Fitting","body":"Hello"}""")
        assertEquals(201, r.status, r.text)
        return r.id()
    }

    @Test
    fun `a new inquiry reaches every other reply User with the toggle on and links to the thread`() {
        val author = person()
        val on = person()
        val off = person().also { prefs(it, inquiry = false) }
        val viewer = person(DefaultRoles.VIEWER)
        val id = inquire(author.token, "Wren Calloway")

        assertEquals(listOf("New inquiry from Wren Calloway"), titles(on))
        val body = bell(on).text
        assertTrue(body.contains(""""type":"new_inquiry"""") && body.contains(""""target":"inquiries/$id"""") && body.contains(""""read":false"""), body)
        assertTrue(body.contains(""""unread":1"""), body)
        assertEquals(0, rows(author), "the author is never told about their own inquiry")
        assertEquals(0, rows(off), "toggle off: no row")
        assertEquals(0, rows(viewer), "no reply Permission: no row")
    }

    @Test
    fun `AI finished and team activity respect their own toggles and Active status`() {
        val on = person()
        val off = person().also { prefs(it, ai = false, team = false) }
        val invited = person(status = UserStatus.INVITED)
        tx.executeWithoutResult {
            service.notify(NotificationType.AI_FINISHED, listOf(on.id, off.id, invited.id), "AI finished grouping 4 images into 2 gowns", "upload")
            service.notify(NotificationType.TEAM_ACTIVITY, listOf(on.id, off.id, invited.id), "Someone joined", "settings")
        }
        assertEquals(setOf("AI finished grouping 4 images into 2 gowns", "Someone joined"), titles(on).toSet())
        assertEquals(0, rows(off))
        assertEquals(0, rows(invited))
    }

    @Test
    fun `a rolled back business transaction leaves no notification`() {
        val p = person()
        assertFailsWith<IllegalStateException> {
            tx.executeWithoutResult {
                service.notify(NotificationType.NEW_INQUIRY, listOf(p.id), "never stored", "inquiries")
                throw IllegalStateException("boom")
            }
        }
        assertEquals(0, rows(p))
    }

    @Test
    fun `the list is the newest 20, newest first, and read and clear only touch the caller's rows`() {
        val a = person()
        val b = person()
        tx.executeWithoutResult { (1..25).forEach { service.notify(NotificationType.TEAM_ACTIVITY, listOf(a.id), "n$it", "settings") } }
        tx.executeWithoutResult { service.notify(NotificationType.TEAM_ACTIVITY, listOf(b.id), "mine-b", "settings") }
        val list = titles(a)
        assertEquals(20, list.size)
        assertEquals("n25", list.first())
        assertEquals("n6", list.last())

        val ids = Regex(""""id":"([0-9a-f-]{36})"""").findAll(bell(a).text).map { it.groupValues[1] }.toList()
        val bId = Regex(""""id":"([0-9a-f-]{36})"""").find(bell(b).text)!!.groupValues[1]
        val read = call("POST", "/api/v1/notifications/read", a.token, """{"ids":["${ids[0]}","${ids[1]}","$bId"]}""")
        assertEquals(204, read.status)
        assertTrue(bell(a).text.contains(""""unread":18"""))
        assertTrue(bell(b).text.contains(""""read":false"""), "someone else's id is ignored")

        assertEquals(422, call("POST", "/api/v1/notifications/read", a.token, """{"ids":[]}""").status)
        assertEquals(422, call("POST", "/api/v1/notifications/read", a.token, """{}""").status)

        assertEquals(204, call("DELETE", "/api/v1/notifications", a.token).status)
        assertEquals(0, rows(a))
        assertEquals(1, rows(b))
        assertTrue(bell(a).text.contains(""""items":[]"""))
        assertEquals(204, call("DELETE", "/api/v1/notifications", a.token).status)
    }

    @Test
    fun `the bell needs a signed in User`() {
        assertEquals(401, call("GET", "/api/v1/notifications", null).status)
        assertEquals(401, call("POST", "/api/v1/notifications/read", null, """{"ids":[]}""").status)
        assertEquals(401, call("DELETE", "/api/v1/notifications", null).status)
    }

    @Test
    fun `a role change tells the other Admins and not the one who made it`() {
        val other = person(DefaultRoles.ADMIN)
        val target = person()
        val token = admin()
        val viewer = roles.roles().first { it.name == DefaultRoles.VIEWER }.id
        val v = Regex(""""id":"${target.id}"[^}]*"version":(\d+)""").find(call("GET", "/api/v1/admin/users", token).text)!!.groupValues[1].toLong()
        assertEquals(200, call("PATCH", "/api/v1/admin/users/${target.id}", token, """{"roleId":"$viewer"}""", v).status)

        // A role change bumps the permission epoch, so every token issued before it is out of date.
        val fresh = Person(other.id, other.email, field(client.let { it.exchange(it.signIn(other.email, PW)).body }, "accessToken")!!)
        assertEquals(listOf("Bell Person is now Viewer"), titles(fresh))
        val adminId = users.find(TestSupport.ADMIN_EMAIL)!!.id
        assertEquals(0, jdbc.queryForObject("select count(*) from notification where user_id = ?", Long::class.java, adminId)!!, "the actor is not told")
        assertFalse(titles(target).any { it.contains("is now") })
    }
}
