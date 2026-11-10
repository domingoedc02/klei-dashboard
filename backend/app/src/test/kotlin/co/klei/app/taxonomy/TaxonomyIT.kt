package co.klei.app.taxonomy

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.storage.ObjectStorePort
import co.klei.core.taxonomy.TaxonomyChanged
import co.klei.core.taxonomy.UsageCounter
import org.junit.jupiter.api.MethodOrderer
import org.junit.jupiter.api.Order
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.TestMethodOrder
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.context.event.EventListener
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
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 3.2: Taxonomy read for any token, write for the AI settings permission, validation, in-use removal, rename event, seeds as ciphertext, AI behavior fields. */
@Testcontainers
@Import(RecordingMailConfig::class, TaxonomyIT.Probes::class)
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class TaxonomyIT {
    @TestConfiguration
    class Probes {
        @Bean @Primary fun usage() = UsageCounter { used[it] ?: 0L }
        @EventListener fun seen(e: TaxonomyChanged) { events += e }
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        val used = ConcurrentHashMap<UUID, Long>()
        val events = CopyOnWriteArrayList<TaxonomyChanged>()

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
    @Autowired lateinit var audit: AuditService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var jdbc: JdbcTemplate

    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", "http://127.0.0.1:${ctx.webServer!!.port}")
    private fun token(email: String, pw: String): String { val c = client(); return field(c.exchange(c.signIn(email, pw)).body, "accessToken")!! }
    private fun admin() = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
    private fun get(t: String) = client().api("GET", "/api/v1/taxonomy", null, t)
    private fun put(t: String, body: String, ifMatch: Long? = null) =
        client().api("PUT", "/api/v1/taxonomy", body, t, if (ifMatch == null) emptyMap() else mapOf("If-Match" to ifMatch.toString()))
    private fun item(body: String, type: String, value: String) =
        Regex(""""id":"([^"]+)","type":"$type","value":"${Regex.escape(value)}","version":(\d+)""").find(body)!!.groupValues.let { UUID.fromString(it[1]) to it[2].toLong() }
    private fun aiPut(t: String, extra: String, ifMatch: Long) = client().api(
        "PUT", "/api/v1/admin/ai",
        """{"preset":"ollama","baseUrl":"http://localhost:11434/v1","embeddingModel":"dinov2-base","temperature":0.7,"maxTokens":1024$extra}""", t, mapOf("If-Match" to ifMatch.toString()),
    )

    @Test @Order(1) fun `any signed-in user reads the seeds grouped by type, only the AI settings permission writes`() {
        val c = client()
        assertEquals(401, c.api("GET", "/api/v1/taxonomy").status)
        val email = "tax-${UUID.randomUUID()}@example.test"
        val staff = roles.roles().first { it.name == DefaultRoles.STAFF }.id
        tx.execute { users.create("Tess Staff", email, "Stafer-pass-1", staff, UserStatus.ACTIVE, true) }
        val t = token(email, "Stafer-pass-1")
        val r = get(t)
        assertEquals(200, r.status, r.body)
        val types = Regex(""""type":"(\w+)","values"""").findAll(r.body).map { it.groupValues[1] }.toList()
        assertEquals(listOf("silhouette", "fabric", "neckline", "sleeve", "train"), types)
        assertEquals(19, Regex(""""value":""").findAll(r.body).count())
        for (v in listOf("A-line", "Ball gown", "Mikado", "Sweetheart", "Cap sleeve", "Cathedral")) assertTrue(r.body.contains("\"$v\""), v)
        assertEquals(403, put(t, """{"op":"add","type":"fabric","value":"Silk"}""").status)
    }

    @Test @Order(2) fun `the seed rows are ciphertext`() {
        val bytes = jdbc.query("select value_ct from taxonomy_value") { rs, _ -> String(rs.getBytes(1), Charsets.ISO_8859_1) }
        assertEquals(19, bytes.size)
        assertTrue(bytes.none { it.contains("Mikado") || it.contains("A-line") })
    }

    @Test @Order(3) fun `add trims, a duplicate in the same type is refused whatever the case, another type may repeat it`() {
        val t = admin()
        val ok = put(t, """{"op":"add","type":"fabric","value":"  Charmeuse  "}""")
        assertEquals(200, ok.status, ok.body)
        item(ok.body, "fabric", "Charmeuse")
        val dup = put(t, """{"op":"add","type":"fabric","value":"CHARMEUSE"}""")
        assertEquals(422, dup.status, dup.body)
        assertTrue(dup.body.contains(""""field":"value","code":"duplicate""""), dup.body)
        assertFalse(dup.body.contains("CHARMEUSE"))
        assertEquals(200, put(t, """{"op":"add","type":"train","value":"Charmeuse"}""").status)
    }

    @Test @Order(4) fun `empty, long, unknown type and unknown op are 422 with codes only`() {
        val t = admin()
        fun code(body: String, field: String, code: String) {
            val r = put(t, body)
            assertEquals(422, r.status, r.body)
            assertTrue(r.body.contains(""""field":"$field","code":"$code""""), r.body)
        }
        code("""{"op":"add","type":"fabric","value":"   "}""", "value", "required")
        code("""{"op":"add","type":"fabric"}""", "value", "required")
        code("""{"op":"add","type":"fabric","value":"${"x".repeat(61)}"}""", "value", "too_long")
        code("""{"op":"add","type":"hat","value":"Bowler"}""", "type", "invalid")
        code("""{"op":"explode","type":"fabric","value":"Silk"}""", "op", "invalid")
    }

    @Test @Order(5) fun `a rename keeps the id, needs the version, fires the event and is audited without the value`() {
        val t = admin()
        val (id, version) = item(get(t).body, "neckline", "Bateau")
        events.clear()
        assertEquals(409, put(t, """{"op":"rename","id":"$id","value":"Boat neck"}""", version + 7).status)
        assertTrue(events.isEmpty())
        val r = put(t, """{"op":"rename","id":"$id","value":"Boat neck"}""", version)
        assertEquals(200, r.status, r.body)
        val (after, next) = item(r.body, "neckline", "Boat neck")
        assertEquals(id, after)
        assertEquals(version + 1, next)
        assertEquals(listOf(id), events.map { it.id })
        val details = tx.execute { audit.all().filter { it.action == "taxonomy_changed" }.map { it.detail } }!!
        assertTrue(details.contains("renamed neckline"), details.toString())
        assertFalse(details.any { it!!.contains("Boat") || it.contains("Bateau") })
        val clash = put(t, """{"op":"rename","id":"$id","value":"SQUARE"}""", next)
        assertEquals(422, clash.status, clash.body)
    }

    @Test @Order(6) fun `a value in use cannot be removed and the 409 says by how many`() {
        val t = admin()
        val (id, version) = item(get(t).body, "silhouette", "Mermaid")
        used[id] = 4
        val r = put(t, """{"op":"remove","id":"$id"}""", version)
        assertEquals(409, r.status, r.body)
        assertTrue(r.body.contains(""""extensions":{"usedBy":4}"""), r.body)
        assertTrue(get(t).body.contains("\"Mermaid\""))
        used.remove(id)
    }

    @Test @Order(7) fun `an unused value is removed with its version and the removal is audited`() {
        val t = admin()
        val (id, version) = item(get(t).body, "train", "Sweep")
        assertEquals(409, put(t, """{"op":"remove","id":"$id"}""", version + 3).status)
        assertEquals(404, put(t, """{"op":"remove","id":"${UUID.randomUUID()}"}""", 0).status)
        val r = put(t, """{"op":"remove","id":"$id"}""", version)
        assertEquals(200, r.status, r.body)
        assertFalse(r.body.contains("\"Sweep\""))
        val details = tx.execute { audit.all().filter { it.action == "taxonomy_changed" }.map { it.detail } }!!
        assertTrue(details.contains("removed train"), details.toString())
    }

    @Test @Order(8) fun `AI behavior defaults are 3 and warm, ranges are enforced, advanced needs a model`() {
        val t = admin()
        val first = client().api("GET", "/api/v1/admin/ai", null, t)
        assertTrue(first.body.contains(""""sensitivity":3"""), first.body)
        assertTrue(first.body.contains(""""tone":"warm""""), first.body)
        assertTrue(first.body.contains(""""advanced":false"""), first.body)
        for ((extra, field, code) in listOf(
            Triple(""","sensitivity":0""", "sensitivity", "out_of_range"),
            Triple(""","sensitivity":6""", "sensitivity", "out_of_range"),
            Triple(""","tone":"angry"""", "tone", "invalid"),
            Triple(""","advanced":true""", "advanced", "needs_model"),
        )) {
            val r = aiPut(t, extra, 0)
            assertEquals(422, r.status, r.body)
            assertTrue(r.body.contains(""""field":"$field","code":"$code""""), r.body)
        }
        val ok = aiPut(t, ""","sensitivity":5,"tone":"factual","visionModelAdv":"vision-big","advanced":true""", 0)
        assertEquals(200, ok.status, ok.body)
        assertTrue(ok.body.contains(""""sensitivity":5""") && ok.body.contains(""""tone":"factual"""") && ok.body.contains(""""advanced":true"""), ok.body)
        val stored = Regex(""""version":(\d+)""").find(ok.body)!!.groupValues[1].toLong()
        val cleared = aiPut(t, "", stored)
        assertEquals(422, cleared.status, "an absent model clears it, so a kept advanced switch has none: ${cleared.body}")
        val kept = aiPut(t, ""","visionModelAdv":"vision-big"""", Regex(""""version":(\d+)""").find(ok.body)!!.groupValues[1].toLong())
        assertEquals(200, kept.status, kept.body)
        assertTrue(kept.body.contains(""""sensitivity":5""") && kept.body.contains(""""tone":"factual""""), "absent behavior fields keep the stored value: ${kept.body}")
    }
}
