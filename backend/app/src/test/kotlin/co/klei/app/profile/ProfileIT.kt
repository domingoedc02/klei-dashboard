package co.klei.app.profile

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.upload.FakeStore
import co.klei.app.upload.Images
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
import java.io.ByteArrayInputStream
import java.net.ServerSocket
import java.util.UUID
import javax.imageio.ImageIO
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Story 6.1: a User's own name, photo and password. */
@Testcontainers
@Import(RecordingMailConfig::class, ProfileIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class ProfileIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Profile-pass-1"
        private const val NEW = "Fresh-pass-22"

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
    @Autowired lateinit var store: FakeStore
    @Autowired lateinit var audit: AuditService

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", api)

    private class Session(val email: String, val access: String, val refresh: String)

    private fun newUser(role: String = DefaultRoles.VIEWER): String {
        val email = "pia-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        tx.execute { users.create("Pia Profile", email, PW, rid, UserStatus.ACTIVE, true) }
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

    private fun avatar(token: String?, bytes: ByteArray, mime: String = "image/jpeg"): UploadClient.Resp {
        val boundary = "klei" + UUID.randomUUID().toString().replace("-", "")
        val head = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"me.jpg\"\r\nContent-Type: $mime\r\n\r\n"
        val body = head.toByteArray() + bytes + "\r\n--$boundary--\r\n".toByteArray()
        return UploadClient.call("PUT", "$api/api/v1/me/avatar", token, body, mapOf("Content-Type" to "multipart/form-data; boundary=$boundary"))
    }

    private fun refresh(token: String) = client().api("POST", "/api/v1/auth/refresh", """{"refreshToken":"$token"}""").status
    private fun passwordBody(current: String, new: String) = """{"current":"$current","new":"$new"}"""
    private fun version(r: UploadClient.Resp) = Regex(""""version":(\d+)""").find(r.text)!!.groupValues[1].toLong()
    private fun changed() = tx.execute { audit.all().filter { it.action == "password_changed" } }!!

    @Test fun `every route needs a sign-in`() {
        assertEquals(401, call("GET", "/api/v1/me/profile", null).status)
        assertEquals(401, call("PATCH", "/api/v1/me/profile", null, """{"name":"X"}""", 0).status)
        assertEquals(401, avatar(null, Images.jpeg()).status)
        assertEquals(401, call("GET", "/api/v1/me/avatar", null).status)
        assertEquals(401, call("DELETE", "/api/v1/me/avatar", null).status)
        assertEquals(401, call("POST", "/api/v1/me/password", null, passwordBody(PW, NEW)).status)
    }

    @Test fun `any Role reads and renames itself, with validation and the version`() {
        val s = signIn(newUser())
        val got = call("GET", "/api/v1/me/profile", s.access)
        assertEquals(200, got.status)
        assertTrue(got.text.contains("\"name\":\"Pia Profile\"") && got.text.contains(s.email) && got.text.contains("\"avatar\":null"), got.text)

        val v = version(got)
        val named = call("PATCH", "/api/v1/me/profile", s.access, """{"name":"  Pia Q. Profile  "}""", v)
        assertEquals(200, named.status)
        assertTrue(named.text.contains("\"name\":\"Pia Q. Profile\""), named.text)
        assertEquals(v + 1, version(named))
        assertTrue(call("GET", "/api/v1/me", s.access).text.contains("Pia Q. Profile"))

        assertEquals(409, call("PATCH", "/api/v1/me/profile", s.access, """{"name":"Late"}""", v).status)
        assertEquals(400, call("PATCH", "/api/v1/me/profile", s.access, """{"name":"No header"}""").status)
        for (bad in listOf("{}", """{"name":"   "}""", """{"name":"${"x".repeat(81)}"}""")) {
            val r = call("PATCH", "/api/v1/me/profile", s.access, bad, version(named))
            assertEquals(422, r.status, bad)
            assertTrue(r.text.contains("\"field\":\"name\""), r.text)
        }
        assertEquals(200, call("PATCH", "/api/v1/me/profile", s.access, """{"name":"${"x".repeat(80)}"}""", version(named)).status)
    }

    @Test fun `a photo is rebuilt as a small JPEG without its metadata, served no-store, replaced and removed with its objects`() {
        val s = signIn(newUser())
        assertEquals(404, call("GET", "/api/v1/me/avatar", s.access).status)
        val before = store.objects.size

        val first = avatar(s.access, Images.jpeg(600, 400, comment = "SENTINEL-EXIF-GPS"))
        assertEquals(200, first.status, first.text)
        assertFalse(first.text.contains("\"avatar\":null"), first.text)
        assertEquals(before + 1, store.objects.size)
        val served = call("GET", "/api/v1/me/avatar", s.access)
        assertEquals(200, served.status)
        assertEquals("image/jpeg", served.header("Content-Type"))
        assertEquals("no-store", served.header("Cache-Control"))
        assertEquals("nosniff", served.header("X-Content-Type-Options"))
        assertFalse(String(served.body, Charsets.ISO_8859_1).contains("SENTINEL-EXIF-GPS"))
        val img = assertNotNull(ImageIO.read(ByteArrayInputStream(served.body)))
        assertEquals(256, img.width)
        assertEquals(171, img.height)
        assertTrue(call("GET", "/api/v1/me", s.access).text.contains("\"avatar\":"))

        assertEquals(200, avatar(s.access, Images.png(100, 100), "image/png").status)
        assertEquals(before + 1, store.objects.size, "the old object is gone once the new one is in")
        assertEquals(200, avatar(s.access, Images.WEBP, "image/webp").status)
        assertEquals(before + 1, store.objects.size)

        assertEquals(204, call("DELETE", "/api/v1/me/avatar", s.access).status)
        assertEquals(before, store.objects.size)
        assertEquals(404, call("GET", "/api/v1/me/avatar", s.access).status)
        assertEquals(204, call("DELETE", "/api/v1/me/avatar", s.access).status, "removing nothing is fine")
        assertTrue(call("GET", "/api/v1/me", s.access).text.contains("\"avatar\":null"))
    }

    @Test fun `a photo over 2 MB is 413, a wrong type is 415, and a refused photo changes nothing`() {
        val s = signIn(newUser())
        assertEquals(200, avatar(s.access, Images.jpeg(100, 100)).status)
        val kept = store.objects.size
        val big = Images.jpeg(100, 100) + ByteArray(2 * 1024 * 1024 + 1)
        assertEquals(413, avatar(s.access, big).status)
        assertEquals(415, avatar(s.access, "just text".toByteArray(), "text/plain").status)
        assertEquals(415, avatar(s.access, Images.polyglot()).status)
        assertEquals(kept, store.objects.size)
        assertEquals(200, call("GET", "/api/v1/me/avatar", s.access).status)
    }

    @Test fun `a wrong current password and a weak new one are refused with their field, and change nothing`() {
        val s = signIn(newUser())
        val wrong = call("POST", "/api/v1/me/password", s.access, passwordBody("Not-my-pass-1", NEW))
        assertEquals(422, wrong.status)
        assertTrue(wrong.text.contains("\"field\":\"current\"") && wrong.text.contains("\"code\":\"incorrect\""), wrong.text)
        for (weak in listOf("short1", "nodigitshere", "x".repeat(129) + "1")) {
            val r = call("POST", "/api/v1/me/password", s.access, passwordBody(PW, weak))
            assertEquals(422, r.status, weak)
            assertTrue(r.text.contains("\"field\":\"new\""), r.text)
        }
        assertEquals(422, call("POST", "/api/v1/me/password", s.access, """{"new":"$NEW"}""").status)
        assertEquals(0, changed().count { it.actorId == jdbcId(s.email) })
        signIn(s.email)
    }

    @Test fun `changing the password keeps this sign-in, ends the others, switches to the new password and is audited`() {
        val email = newUser()
        val here = signIn(email)
        val there = signIn(email)
        val r = call("POST", "/api/v1/me/password", here.access, passwordBody(PW, NEW))
        assertEquals(204, r.status, r.text)

        assertEquals(200, call("GET", "/api/v1/me", here.access).status, "this access token stays valid")
        assertEquals(200, refresh(here.refresh), "this sign-in carries on")
        assertEquals(401, refresh(there.refresh), "the other device is signed out")
        assertEquals(401, call("GET", "/api/v1/me", there.access).status)

        val c = client()
        c.authorize()
        assertNull(c.login(email, PW).code(), "the old password no longer works")
        signIn(email, NEW)
        val entries = changed().filter { it.actorId == jdbcId(email) }
        assertEquals(1, entries.size)
        assertFalse(entries[0].detail?.contains(NEW) ?: false)
    }

    @Test fun `wrong current passwords count toward the sign-in throttle`() {
        val email = newUser()
        val s = signIn(email)
        repeat(5) { assertEquals(422, call("POST", "/api/v1/me/password", s.access, passwordBody("Wrong-guess-$it", NEW)).status) }
        assertEquals(429, call("POST", "/api/v1/me/password", s.access, passwordBody(PW, NEW)).status, "even the right one waits")
        assertEquals(0, changed().count { it.actorId == jdbcId(email) })
    }

    private fun jdbcId(email: String): String = tx.execute { users.find(email)!!.id.toString() }!!
}
