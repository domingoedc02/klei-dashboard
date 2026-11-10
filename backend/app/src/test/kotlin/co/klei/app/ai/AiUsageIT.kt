package co.klei.app.ai

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.core.ai.AiCall
import co.klei.core.ai.AiOutcome
import co.klei.core.ai.AiPurpose
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.storage.ObjectStorePort
import co.klei.crypto.CryptoException
import co.klei.crypto.FieldCodec
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestMethodOrder
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.ActiveProfiles
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
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 3.3: the usage list, its Permission, paging, who is named, no prompt or response on the wire, own-transaction rows, closed purpose and outcome sets. */
@Testcontainers
@Import(RecordingMailConfig::class)
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class AiUsageIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PROMPT = "PROMPT-SENTINEL-zq81"
        private const val RESPONSE = "RESPONSE-SENTINEL-zq82"

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
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var recorder: AiUsageRecorder

    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
    private fun token(email: String, pw: String): String { val c = client(); return field(c.exchange(c.signIn(email, pw)).body, "accessToken")!! }
    private fun admin() = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
    private fun get(t: String?, page: String = "") = client().api("GET", "/api/v1/admin/ai/usage$page", null, t)
    private fun rows() = jdbc.queryForObject("select count(*) from ai_usage", Int::class.java)!!
    private fun log(user: UUID?, purpose: AiPurpose = AiPurpose.EMBED, outcome: AiOutcome = AiOutcome.OK, model: String? = "dinov2-base") =
        recorder.record(AiCall(purpose, user), model, 2048, outcome, 17, PROMPT, RESPONSE)

    @Test @Order(1) fun `only the AI settings permission reads the usage list`() {
        assertEquals(401, get(null).status)
        val email = "use-${UUID.randomUUID()}@example.test"
        val staff = roles.roles().first { it.name == DefaultRoles.STAFF }.id
        tx.execute { users.create("Una Staff", email, "Stafer-pass-1", staff, UserStatus.ACTIVE, true) }
        assertEquals(403, get(token(email, "Stafer-pass-1")).status)
    }

    @Test @Order(2) fun `an empty log is page 1 of 1`() {
        val r = get(admin())
        assertEquals(200, r.status, r.body)
        assertEquals("""{"items":[],"page":1,"pages":1}""", r.body)
    }

    @Test @Order(3) fun `a row carries time, user, purpose, model, size, outcome and duration, and never the prompt or response`() {
        val id = users.let { u -> tx.execute { u.create("Uma Staff", "uma-${UUID.randomUUID()}@example.test", "Stafer-pass-1", roles.roles().first { it.name == DefaultRoles.STAFF }.id, UserStatus.ACTIVE, true).id }!! }
        log(id, AiPurpose.DESCRIBE, AiOutcome.TIMEOUT)
        val r = get(admin())
        assertEquals(200, r.status, r.body)
        for (want in listOf(""""user":"Uma Staff"""", """"purpose":"describe"""", """"model":"dinov2-base"""", """"size":2048""", """"outcome":"timeout"""", """"durationMs":17""", """"time":"""")) assertTrue(r.body.contains(want), "$want in ${r.body}")
        assertFalse(r.body.contains(PROMPT) || r.body.contains(RESPONSE) || r.body.contains("prompt") || r.body.contains("response"), r.body)
    }

    @Test @Order(4) fun `no user reads as System and a removed user as Deleted user`() {
        log(null, AiPurpose.CHAT)
        log(UUID.randomUUID())
        val body = get(admin()).body
        assertTrue(body.contains(""""user":"System""""), body)
        assertTrue(body.contains(""""user":"Deleted user""""), body)
    }

    @Test @Order(5) fun `50 per page, newest first, pages counted, bad page numbers are 422`() {
        repeat(60) { log(null, AiPurpose.TEST, AiOutcome.ERROR, "m$it") }
        val total = rows()
        val pages = (total + 49) / 50
        val t = admin()
        val first = get(t).body
        assertEquals(50, Regex(""""purpose":""").findAll(first).count())
        assertTrue(first.contains(""""pages":$pages"""), first)
        assertTrue(first.indexOf("\"m59\"") in 0 until first.indexOf("\"m58\""), "newest first")
        assertEquals(total - 50, Regex(""""purpose":""").findAll(get(t, "?page=2").body).count())
        assertEquals(0, Regex(""""purpose":""").findAll(get(t, "?page=${pages + 1}").body).count())
        for (p in listOf("0", "-3", "99999999")) assertEquals(422, get(t, "?page=$p").status, p)
    }

    @Test @Order(6) fun `a rolled-back caller still leaves its usage row`() {
        val before = rows()
        tx.execute { s -> log(null, AiPurpose.EMBED, AiOutcome.ERROR); s.setRollbackOnly() }
        assertEquals(before + 1, rows())
    }

    @Test @Order(7) fun `purpose and outcome are closed sets, an unknown stored value does not decode`() {
        assertEquals(setOf("test", "embed", "describe", "chat", "verify"), AiPurpose.entries.map { it.name.lowercase() }.toSet())
        assertEquals(setOf("ok", "error", "timeout", "refused"), AiOutcome.entries.map { it.name.lowercase() }.toSet())
        assertFailsWith<CryptoException> { FieldCodec.decEnum(FieldCodec.enc("sneeze"), AiPurpose::class.java) }
        assertFailsWith<CryptoException> { FieldCodec.decEnum(FieldCodec.enc("maybe"), AiOutcome::class.java) }
    }
}
