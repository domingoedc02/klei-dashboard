package co.klei.app.signature

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

/** Story 6.2: reply signature and the Studio block. */
@Testcontainers
@Import(RecordingMailConfig::class, SignatureIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class SignatureIT {
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
        val email = "sig-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        tx.execute { users.create("Sig Person", email, PW, rid, UserStatus.ACTIVE, true) }
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
    private fun mine(token: String) = call("GET", "/api/v1/me/signature", token)
    private fun put(token: String, json: String, v: Long) = call("PUT", "/api/v1/me/signature", token, json, v)
    private fun body(on: Boolean = true, signoff: String = "Warm regards,", name: String = "Mara Lindqvist", title: String = "Consultant", phone: String = "+1 555 0100") =
        """{"enabled":$on,"signoff":"$signoff","name":"$name","title":"$title","phone":"$phone"}"""
    private fun admin() = signIn(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)

    @Test fun `every route needs a sign-in, and the Studio block needs Manage staff`() {
        assertEquals(401, call("GET", "/api/v1/me/signature", null).status)
        assertEquals(401, call("PUT", "/api/v1/me/signature", null, body(), 0).status)
        assertEquals(401, call("GET", "/api/v1/admin/workspace", null).status)
        val viewer = signIn(newUser())
        assertEquals(403, call("GET", "/api/v1/admin/workspace", viewer.access).status)
        assertEquals(403, call("PUT", "/api/v1/admin/workspace", viewer.access, """{"studioName":"X","studioAddress":""}""", 0).status)
    }

    @Test fun `a User with no row yet gets a blank, switched-off signature that opens at version zero`() {
        val s = signIn(newUser())
        val r = mine(s.access)
        assertEquals(200, r.status)
        assertTrue(r.text.contains("\"enabled\":false") && r.text.contains("\"name\":\"Sig Person\"") && r.text.contains("\"preview\":\"\""), r.text)
        assertEquals(0L, version(r))
    }

    @Test fun `any Role saves its own signature, the preview follows it, and the version moves`() {
        val s = signIn(newUser())
        val saved = put(s.access, body(), 0)
        assertEquals(200, saved.status, saved.text)
        assertEquals(1L, version(saved))
        assertTrue(saved.text.contains("Warm regards,\\nMara Lindqvist\\nConsultant\\n"), saved.text)
        assertTrue(saved.text.contains("Klei Bridal") || saved.text.contains("+1 555 0100"), saved.text)

        val again = put(s.access, body(name = "Mara L."), 1)
        assertEquals(200, again.status)
        assertEquals(2L, version(again))
        assertTrue(mine(s.access).text.contains("Mara L."))

        val off = put(s.access, body(on = false), 2)
        assertTrue(off.text.contains("\"preview\":\"\""), off.text)
        assertTrue(off.text.contains("\"name\":\"Mara Lindqvist\""), "fields are kept while switched off")
        assertEquals(409, put(s.access, body(), 1).status)
        assertEquals(400, call("PUT", "/api/v1/me/signature", s.access, body()).status)
    }

    @Test fun `one User never sees another User's signature`() {
        val a = signIn(newUser()); val b = signIn(newUser())
        assertEquals(200, put(a.access, body(name = "OnlyForPia"), 0).status)
        assertFalse(mine(b.access).text.contains("OnlyForPia"))
    }

    @Test fun `bad fields are named by code and never echoed`() {
        val s = signIn(newUser())
        val long = "x".repeat(81)
        for ((json, field, code) in listOf(
            Triple("""{"signoff":"a","name":"b","title":"c","phone":"d"}""", "enabled", "required"),
            Triple(body(name = long), "name", "too_long"),
            Triple(body(title = long), "title", "too_long"),
            Triple(body(phone = long), "phone", "too_long"),
            Triple(body(signoff = long), "signoff", "too_long"),
            Triple(body(name = "a\\nb"), "name", "invalid"),
        )) {
            val r = put(s.access, json, 0)
            assertEquals(422, r.status, json)
            assertTrue(r.text.contains("\"field\":\"$field\"") && r.text.contains("\"code\":\"$code\""), r.text)
            assertFalse(r.text.contains(long))
        }
        assertEquals(200, put(s.access, body(name = "x".repeat(80)), 0).status)
    }

    @Test fun `an Admin sets the Studio, every Role sees it in the preview, and the rules hold`() {
        val a = admin()
        val first = call("GET", "/api/v1/admin/workspace", a.access)
        assertEquals(200, first.status)
        val v = version(first)
        val set = call("PUT", "/api/v1/admin/workspace", a.access, """{"studioName":"  Klei Bridal  ","studioAddress":"12 Rose Lane\n\n Suite 4 \nPortland"}""", v)
        assertEquals(200, set.status, set.text)
        assertEquals(v + 1, version(set))
        assertTrue(set.text.contains("\"studioName\":\"Klei Bridal\"") && set.text.contains("12 Rose Lane\\nSuite 4\\nPortland"), set.text)

        val staff = signIn(newUser(DefaultRoles.STAFF))
        val saved = put(staff.access, body(), 0)
        assertTrue(saved.text.contains("Klei Bridal \u00b7 +1 555 0100\\n12 Rose Lane\\nSuite 4\\nPortland"), saved.text)
        assertTrue(mine(staff.access).text.contains("\"studio\":{\"name\":\"Klei Bridal\""))

        assertEquals(409, call("PUT", "/api/v1/admin/workspace", a.access, """{"studioName":"Late","studioAddress":""}""", v).status)
        val bad = listOf(
            """{"studioName":"${"x".repeat(81)}","studioAddress":""}""" to "studioName",
            """{"studioName":"ok","studioAddress":"1\n2\n3\n4\n5"}""" to "studioAddress",
            """{"studioName":"ok","studioAddress":"${"y".repeat(241)}"}""" to "studioAddress",
        )
        for ((json, field) in bad) {
            val r = call("PUT", "/api/v1/admin/workspace", a.access, json, v + 1)
            assertEquals(422, r.status, json)
            assertTrue(r.text.contains("\"field\":\"$field\""), r.text)
        }
    }

    @Test fun `deleting a User removes their signature`() {
        val email = newUser()
        val s = signIn(email)
        assertEquals(200, put(s.access, body(), 0).status)
        val id = tx.execute { users.find(email)!!.id }!!
        assertEquals(1, jdbc.queryForObject("select count(*) from signature where user_id = ?", Int::class.java, id))
        val a = admin()
        assertEquals(204, call("DELETE", "/api/v1/admin/users/$id", a.access).status)
        assertEquals(0, jdbc.queryForObject("select count(*) from signature where user_id = ?", Int::class.java, id))
    }
}
