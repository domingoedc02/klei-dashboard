package co.klei.app.prefs

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
import kotlin.test.assertTrue

/** Story 6.3: preferences and notification toggles. */
@Testcontainers
@Import(RecordingMailConfig::class, PreferencesIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class PreferencesIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Profile-pass-1"
        
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

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", api)

    private class Session(val email: String, val access: String, val refresh: String)

    private fun newUser(role: String = DefaultRoles.VIEWER): String {
        val email = "pref-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        tx.execute { users.create("Pref Person", email, PW, rid, UserStatus.ACTIVE, true) }
        return email
    }

    private fun signIn(email: String, password: String = PW): Session {
        val c = client()
        val t = c.exchange(c.signIn(email, password)).body
        return Session(email, field(t, "accessToken")!!, field(t, "refreshToken")!!)
    }

    private fun call(method: String, path: String, token: String?, json: String? = null, version: Long? = null) =
        UploadClient.call(
            method, "$api$path", token, json?.toByteArray(),
            buildMap { if (json != null) put("Content-Type", "application/json"); if (version != null) put("If-Match", version.toString()) },
        )

    private fun version(r: UploadClient.Resp) = Regex(""""version":(\d+)""").find(r.text)!!.groupValues[1].toLong()
    private fun mine(token: String) = call("GET", "/api/v1/me/preferences", token)
    private fun put(token: String, json: String, v: Long) = call("PUT", "/api/v1/me/preferences", token, json, v)
    private fun body(
        zone: String? = "Europe/Paris", fmt: String = "DD/MM/YYYY", page: String = "gallery", enter: Boolean = true,
        inquiry: Boolean = true, ai: Boolean = false, team: Boolean = true,
    ) = """{"timezone":${zone?.let { "\"$it\"" }},"dateFormat":"$fmt","startPage":"$page","enterToSend":$enter,"newInquiry":$inquiry,"aiFinished":$ai,"teamActivity":$team}"""

    @Test fun `every route needs a sign-in`() {
        assertEquals(401, call("GET", "/api/v1/me/preferences", null).status)
        assertEquals(401, call("PUT", "/api/v1/me/preferences", null, body(), 0).status)
    }

    @Test fun `a User who never saved gets the defaults at version zero, on the preferences route and on me`() {
        val s = signIn(newUser())
        val r = mine(s.access)
        assertEquals(200, r.status)
        assertTrue(r.text.contains("\"dateFormat\":\"MM/DD/YYYY\"") && r.text.contains("\"startPage\":\"dashboard\"") && r.text.contains("\"enterToSend\":false"), r.text)
        assertTrue(r.text.contains("\"newInquiry\":true") && r.text.contains("\"aiFinished\":true") && r.text.contains("\"teamActivity\":true"), r.text)
        assertEquals(0L, version(r))
        assertTrue(call("GET", "/api/v1/me", s.access).text.contains("\"preferences\":{"))
    }

    @Test fun `email switches and the digest start off, save, survive an older client, and refuse an unknown digest`() {
        val s = signIn(newUser())
        assertTrue(mine(s.access).text.let { it.contains("\"emailNewInquiry\":false") && it.contains("\"emailAiFinished\":false") && it.contains("\"emailTeamActivity\":false") && it.contains("\"digest\":\"never\"") })
        val full = body().dropLast(1) + ""","emailNewInquiry":true,"emailAiFinished":false,"emailTeamActivity":true,"digest":"hourly"}"""
        assertEquals(200, put(s.access, full, 0).status)
        val kept = { mine(s.access).text.let { it.contains("\"emailNewInquiry\":true") && it.contains("\"emailTeamActivity\":true") && it.contains("\"digest\":\"hourly\"") } }
        assertTrue(kept())
        assertEquals(200, put(s.access, body(zone = null), 1).status)
        assertTrue(kept(), "a body without the email fields keeps them")
        val bad = put(s.access, body().dropLast(1) + ""","digest":"monthly"}""", 2)
        assertTrue(bad.status == 422 && bad.text.contains("\"field\":\"digest\"") && bad.text.contains("\"code\":\"invalid\"") && !bad.text.contains("monthly"), bad.text)
    }

    @Test fun `any Role saves its own preferences and the version moves`() {
        val s = signIn(newUser())
        val saved = put(s.access, body(), 0)
        assertEquals(200, saved.status, saved.text)
        assertEquals(1L, version(saved))
        val again = mine(s.access)
        assertTrue(again.text.contains("\"timezone\":\"Europe/Paris\"") && again.text.contains("\"startPage\":\"gallery\"") && again.text.contains("\"aiFinished\":false"), again.text)
        assertEquals(2L, version(put(s.access, body(zone = null, fmt = "YYYY-MM-DD"), 1)))
        assertTrue(mine(s.access).text.contains("\"timezone\":null"))
        assertEquals(409, put(s.access, body(), 1).status)
        assertEquals(400, call("PUT", "/api/v1/me/preferences", s.access, body()).status)
    }

    @Test fun `a rename and a preferences save never stale each other`() {
        val s = signIn(newUser())
        val prof = call("GET", "/api/v1/me/profile", s.access)
        assertEquals(200, put(s.access, body(), 0).status)
        val rename = call("PATCH", "/api/v1/me/profile", s.access, """{"name":"Renamed Person"}""", version(prof))
        assertEquals(200, rename.status, rename.text)
        assertEquals(200, put(s.access, body(page = "dashboard"), 1).status)
    }

    @Test fun `one User never sees another User's preferences`() {
        val a = signIn(newUser()); val b = signIn(newUser())
        assertEquals(200, put(a.access, body(zone = "Asia/Tokyo"), 0).status)
        assertFalse(mine(b.access).text.contains("Asia/Tokyo"))
    }

    @Test fun `bad values are named by code and never echoed`() {
        val s = signIn(newUser())
        val junk = "Not/AZone-zqjunk"
        for ((json, field, code) in listOf(
            Triple(body(zone = junk), "timezone", "invalid"),
            Triple(body(fmt = "DD.MM.YY"), "dateFormat", "invalid"),
            Triple(body(page = "settings"), "startPage", "invalid"),
            Triple("""{"dateFormat":"MM/DD/YYYY","startPage":"gallery","enterToSend":true,"newInquiry":true,"aiFinished":true,"teamActivity":true}""".replace("\"dateFormat\"", "\"x\""), "dateFormat", "required"),
            Triple(body().replace("\"teamActivity\":true", "\"y\":1"), "teamActivity", "required"),
        )) {
            val r = put(s.access, json, 0)
            assertEquals(422, r.status, json)
            assertTrue(r.text.contains("\"field\":\"$field\"") && r.text.contains("\"code\":\"$code\""), r.text)
            assertFalse(r.text.contains("zqjunk"))
        }
        assertEquals(0L, version(mine(s.access)))
    }

    @Test fun `deleting a User removes their preferences with the row`() {
        val email = newUser()
        val s = signIn(email)
        assertEquals(200, put(s.access, body(), 0).status)
        val id = tx.execute { users.find(email)!!.id }!!
        assertEquals(1, jdbc.queryForObject("select count(*) from app_user where id = ? and prefs_ct is not null", Int::class.java, id))
        assertEquals(204, call("DELETE", "/api/v1/admin/users/$id", signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD).access).status)
        assertEquals(0, jdbc.queryForObject("select count(*) from app_user where id = ?", Int::class.java, id))
    }
}
