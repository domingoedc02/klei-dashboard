package co.klei.app.crypto

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
import co.klei.crypto.CryptoModule
import co.klei.crypto.ObjectCipher
import co.klei.crypto.SealedObject
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.BeforeEach
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
import javax.sql.DataSource
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 9.2: the app runs on KEK 2 while old rows still hold KEK 1; the Admin-only re-wrap moves them and reports counts only. */
@Testcontainers
@Import(RecordingMailConfig::class, KeyRotationIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class KeyRotationIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Keys-pass-1"
        private const val BUCKET = "bk"

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            r.add("klei.auth-base-url") { "http://127.0.0.1:$authPort" }
            TestSupport.keys(r)
            r.add("KLEI_KEK_2") { TestSupport.key(2) }
            r.add("KLEI_KEK_ACTIVE") { "2" }
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var db: DataSource
    @Autowired lateinit var cipher: ObjectCipher

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private val oldKeys = mapOf(
        "KLEI_KEK_1" to TestSupport.key(1), "KLEI_KEK_ACTIVE" to "1",
        "KLEI_BIDX_KEY" to TestSupport.key(50), "KLEI_JWT_KEY" to TestSupport.key(100),
    )

    private fun token(email: String, password: String): String {
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return field(c.exchange(c.signIn(email, password)).body, "accessToken")!!
    }
    private val admin get() = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
    private fun staff(): String {
        val email = "ks-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Sam Staff", email, PW, roles.roles().first { it.name == DefaultRoles.STAFF }.id, UserStatus.ACTIVE, true) }
        return token(email, PW)
    }
    private fun json(method: String, path: String, token: String?) = UploadClient.call(method, "$api$path", token)
    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    /** [n] stored objects still wrapped by KEK 1, as they would be after the first deploy of a rotation. */
    private fun legacy(n: Int): Map<UUID, ByteArray> {
        val m = CryptoModule(oldKeys, db)
        return (1..n).associate {
            val id = UUID.randomUUID()
            val body = "legacy $it".toByteArray()
            val sealed = m.objects.encrypt(body, BUCKET, id)
            assertEquals(1, sealed.kekVersion)
            jdbc.update("insert into stored_object(id, wrapped_dek, kek_version) values (?, ?, ?)", id, sealed.wrappedDek, sealed.kekVersion)
            id to sealed.body
        }
    }

    private fun await(token: String): JsonObject {
        val end = System.nanoTime() + 30_000_000_000L
        while (true) {
            val run = obj(json("GET", "/api/v1/admin/keys/status", token).text)["run"]!!.jsonObject
            if (run["state"]!!.jsonPrimitive.content != "running") return run
            check(System.nanoTime() < end) { "re-wrap did not finish" }
            Thread.sleep(100)
        }
    }

    @BeforeEach fun clean() { jdbc.update("delete from stored_object where kek_version = 1") }

    @Test fun `only a signed-in Admin may read the status or start a re-wrap`() {
        val s = staff()
        assertEquals(401, json("GET", "/api/v1/admin/keys/status", null).status)
        assertEquals(401, json("POST", "/api/v1/admin/keys/rewrap", null).status)
        assertEquals(403, json("GET", "/api/v1/admin/keys/status", s).status)
        assertEquals(403, json("POST", "/api/v1/admin/keys/rewrap", s).status)
    }

    @Test fun `status counts rows per KEK version and names no id and no key`() {
        val ids = legacy(3)
        val r = json("GET", "/api/v1/admin/keys/status", admin)
        assertEquals(200, r.status, r.text)
        val b = obj(r.text)
        assertEquals(2, b["active"]!!.jsonPrimitive.content.toInt())
        assertEquals(2, b["highest"]!!.jsonPrimitive.content.toInt())
        assertEquals("[1,2]", b["configured"].toString().replace(" ", ""))
        assertEquals("3", b["rows"]!!.jsonObject["storedObject"]!!.jsonObject["1"]!!.jsonPrimitive.content)
        assertTrue(b["run"]!!.jsonObject["state"]!!.jsonPrimitive.content in setOf("idle", "done"))
        ids.keys.forEach { assertFalse(r.text.contains(it.toString())) }
        assertFalse(r.text.contains(TestSupport.key(1)) || r.text.contains(TestSupport.key(2)))
    }

    @Test fun `re-wrap moves every row to the active KEK, data still reads, audit and the other Admin are told`() {
        val other = "ks2-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Olive Other", other, PW, roles.roles().first { it.name == DefaultRoles.ADMIN }.id, UserStatus.ACTIVE, true) }
        val t = admin
        val rows = legacy(4)

        val start = json("POST", "/api/v1/admin/keys/rewrap", t)
        assertTrue(start.status == 202 || start.status == 200, start.text)
        val run = await(t)
        assertEquals("done", run["state"]!!.jsonPrimitive.content)
        assertEquals(4, run["storedObject"]!!.jsonPrimitive.content.toInt())

        val after = obj(json("GET", "/api/v1/admin/keys/status", t).text)["rows"]!!.jsonObject["storedObject"]!!.jsonObject
        assertEquals(setOf("2"), after.keys)
        rows.forEach { (id, body) ->
            val wrapped = jdbc.queryForObject("select wrapped_dek from stored_object where id = ?", ByteArray::class.java, id)!!
            assertContentEquals("legacy ${rows.keys.indexOf(id) + 1}".toByteArray(), cipher.decrypt(SealedObject(body, wrapped, 2), BUCKET, id))
        }

        val audit = json("GET", "/api/v1/admin/audit?page=1", t).text
        assertTrue(audit.contains("key_rotation") && audit.contains("storedObject=4"), audit)
        val bell = json("GET", "/api/v1/notifications", token(other, PW)).text
        assertTrue(bell.contains("Keys re-wrapped to version 2"), bell)
    }

    @Test fun `a second request while a run is working is a 409 in_progress, and nothing to do answers idle`() {
        val t = admin
        val rows = legacy(2)
        db.connection.use { c ->
            c.autoCommit = false
            c.prepareStatement("select id from stored_object where id = ? for update").use { it.setObject(1, rows.keys.first()); it.executeQuery().close() }
            try {
                assertEquals(202, json("POST", "/api/v1/admin/keys/rewrap", t).status)
                val again = json("POST", "/api/v1/admin/keys/rewrap", t)
                assertEquals(409, again.status, again.text)
                assertTrue(again.text.contains(""""check":"in_progress""""), again.text)
                assertEquals("running", obj(json("GET", "/api/v1/admin/keys/status", t).text)["run"]!!.jsonObject["state"]!!.jsonPrimitive.content)
            } finally {
                c.rollback()
            }
        }
        assertEquals("done", await(t)["state"]!!.jsonPrimitive.content)
        val idle = json("POST", "/api/v1/admin/keys/rewrap", t)
        assertEquals(200, idle.status, idle.text)
        assertEquals("idle", obj(idle.text)["state"]!!.jsonPrimitive.content)
        assertEquals("0", obj(idle.text)["total"]!!.jsonPrimitive.content)
    }
}
