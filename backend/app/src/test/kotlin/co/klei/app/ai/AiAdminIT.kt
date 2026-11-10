package co.klei.app.ai

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
import org.junit.jupiter.api.AfterAll
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
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 3.1: settings read and save, write-only key, 422 field codes, host-change rule, Test connection against a loopback stub (dev mode). */
@Testcontainers
@Import(RecordingMailConfig::class)
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
@SpringBootTest(webEnvironment = RANDOM_PORT)
class AiAdminIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private val stub = StubProvider()
        private val embedStub = StubProvider()
        private const val EMBED_KEY = "sk-embed-sentinel-9876543210"
        private const val KEY = "sk-sentinel-key-0123456789"

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            r.add("klei.auth-base-url") { "http://127.0.0.1:$authPort" }
            r.add("klei.ai.dev-mode") { "true" }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }

        @AfterAll @JvmStatic fun stopStub() { stub.close(); embedStub.close() }
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
    private fun get(t: String) = client().api("GET", "/api/v1/admin/ai", null, t)
    private fun version(body: String) = Regex(""""version":(\d+)""").find(body)!!.groupValues[1]
    private fun usageRows() = jdbc.queryForObject("select count(*) from ai_usage", Int::class.java)!!
    private fun json(url: String = stub.baseUrl, key: String? = KEY, org: String? = "org-sentinel", temperature: String = "0.7", maxTokens: String = "1024", preset: String = "litellm") =
        """{"preset":"$preset","baseUrl":"$url",${key?.let { """"apiKey":"$it",""" } ?: ""}"organization":"$org","chatModel":"chat-sentinel","visionModel":null,"embeddingModel":"dinov2-base","temperature":$temperature,"maxTokens":$maxTokens}"""
    private fun put(t: String, body: String, ifMatch: String?) =
        client().api("PUT", "/api/v1/admin/ai", body, t, if (ifMatch == null) emptyMap() else mapOf("If-Match" to ifMatch))
    private fun test(t: String) = client().api("POST", "/api/v1/admin/ai/test", null, t)

    @Test @Order(1) fun `only the AI settings permission sees the endpoints`() {
        val c = client()
        assertEquals(401, c.api("GET", "/api/v1/admin/ai").status)
        val email = "ai-${UUID.randomUUID()}@example.test"
        val staff = roles.roles().first { it.name == DefaultRoles.STAFF }.id
        tx.execute { users.create("Ada Staff", email, "Stafer-pass-1", staff, UserStatus.ACTIVE, true) }
        val t = token(email, "Stafer-pass-1")
        assertEquals(403, c.api("GET", "/api/v1/admin/ai", null, t).status)
        assertEquals(403, c.api("POST", "/api/v1/admin/ai/test", null, t).status)
        assertEquals(403, c.api("POST", "/api/v1/admin/ai/models", """{"baseUrl":"${stub.baseUrl}"}""", t).status)
        assertEquals(403, c.api("PUT", "/api/v1/admin/ai", json(), t, mapOf("If-Match" to "0")).status)
    }

    @Test @Order(2) fun `before the first save the form comes back with defaults and no key`() {
        val r = get(admin())
        assertEquals(200, r.status, r.body)
        assertTrue(r.body.contains(""""apiKeySet":false"""), r.body)
        assertTrue(r.body.contains(""""embeddingModel":"dinov2-base""""), r.body)
        assertTrue(r.body.contains(""""status":"not_tested""""), r.body)
        assertEquals("0", version(r.body))
    }

    @Test @Order(3) fun `a bad form is a 422 with field codes only and never the submitted value`() {
        val t = admin()
        val bad = put(t, json(url = "ftp://leaky-host-sentinel/v1", temperature = "3.5", maxTokens = "10"), "0")
        assertEquals(422, bad.status, bad.body)
        for (f in listOf(""""field":"baseUrl","code":"invalid"""", """"field":"temperature","code":"out_of_range"""", """"field":"maxTokens","code":"out_of_range"""")) assertTrue(bad.body.contains(f), bad.body)
        assertFalse(bad.body.contains("leaky-host-sentinel"))
        assertFalse(bad.body.contains(KEY))
        assertEquals(400, put(t, json(), null).status)
        val noKey = put(t, json(key = null), "0")
        assertEquals(422, noKey.status, noKey.body)
        assertTrue(noKey.body.contains(""""field":"apiKey","code":"required""""), noKey.body)
        assertEquals("0", version(get(t).body))
    }

    @Test @Order(4) fun `first save stores the key write-only and later saves keep it when it is absent`() {
        val t = admin()
        val saved = put(t, json(), "0")
        assertEquals(200, saved.status, saved.body)
        assertTrue(saved.body.contains(""""apiKeySet":true"""))
        assertTrue(saved.body.contains("••••••••"))
        assertFalse(saved.body.contains(KEY))
        val v = version(saved.body)
        val again = put(t, json(key = null, maxTokens = "2048"), v)
        assertEquals(200, again.status, again.body)
        assertTrue(again.body.contains(""""apiKeySet":true"""))
        assertTrue(again.body.contains(""""maxTokens":2048"""))
        assertFalse(get(t).body.contains(KEY))
        assertEquals(409, put(t, json(key = null), v).status)
        val stored = jdbc.queryForObject("select api_key_ct from ai_setting", ByteArray::class.java)!!
        assertFalse(String(stored, Charsets.ISO_8859_1).contains(KEY))
    }

    @Test @Order(5) fun `Test connection runs three checks, sends the key, keeps the form version and fills the model list`() {
        val t = admin()
        stub.seen.clear()
        val before = usageRows()
        val v = version(get(t).body)
        val r = test(t)
        assertEquals(200, r.status, r.body)
        assertTrue(r.body.contains(""""status":"connected""""), r.body)
        assertEquals(3, Regex(""""ok":true""").findAll(r.body).count(), r.body)
        assertTrue(r.body.contains("2 models") && r.body.contains("dimension 3"), r.body)
        assertEquals(listOf("GET /v1/models", "POST /v1/embeddings"), stub.seen.map { it.substringBefore(" |") })
        assertTrue(stub.seen.all { it.contains("| Bearer $KEY |") }, stub.seen.toString())
        assertTrue(stub.seen[1].contains("data:image/png;base64,"))
        assertEquals(before + 2, usageRows())
        val form = get(t).body
        assertTrue(form.contains(""""status":"connected""""), form)
        assertTrue(form.contains(""""models":["dinov2-base","chat-sentinel"]"""), form)
        assertEquals(v, version(form))
        assertEquals(200, put(t, json(key = null, maxTokens = "4096"), v).status)
    }

    @Test @Order(6) fun `a changed address needs the key again, resets the verdict and is audited`() {
        val t = admin()
        val v = version(get(t).body)
        val other = "http://localhost:${stub.port}/v1"
        val refused = put(t, json(url = other, key = null), v)
        assertEquals(422, refused.status, refused.body)
        assertTrue(refused.body.contains(""""field":"apiKey","code":"required_on_host_change""""), refused.body)
        val ok = put(t, json(url = other, key = "sk-second-key-0123456789"), v)
        assertEquals(200, ok.status, ok.body)
        assertTrue(ok.body.contains(""""status":"not_tested""""), ok.body)
        assertTrue(ok.body.contains(""""models":[]"""), ok.body)
        val details = tx.execute { audit.all().filter { it.action == "ai_settings_changed" }.map { it.detail } }!!
        assertTrue(details.any { it!!.contains("baseUrl") && it.contains("apiKey") }, details.toString())
        assertFalse(details.any { it!!.contains(KEY) || it.contains("localhost") })
    }

    @Test @Order(7) fun `provider failures become fixed details, never provider text, and every call leaves a usage row`() {
        val t = admin()
        stub.mode = StubProvider.Mode.UNAUTHORIZED
        var before = usageRows()
        var r = test(t)
        assertTrue(r.body.contains(""""status":"failed""""), r.body)
        assertTrue(r.body.contains("Unauthorized") && r.body.contains("Skipped"), r.body)
        assertFalse(r.body.contains("PROVIDER-SECRET-TEXT"))
        assertEquals(before + 1, usageRows())

        stub.mode = StubProvider.Mode.EMPTY_VECTOR
        r = test(t)
        assertTrue(r.body.contains("dimension 0") && r.body.contains(""""status":"failed""""), r.body)

        stub.mode = StubProvider.Mode.SERVER_ERROR
        before = usageRows()
        r = test(t)
        assertTrue(r.body.contains("Provider error 500"), r.body)
        assertFalse(r.body.contains("PROVIDER-SECRET-TEXT"))
        assertEquals(before + 1, usageRows(), "a 500 is retried once, but the call leaves one row; the embedding check is skipped")
        stub.mode = StubProvider.Mode.OK
    }

    @Test @Order(8) fun `a metadata address is refused even in dev mode`() {
        val t = admin()
        val v = version(get(t).body)
        assertEquals(200, put(t, json(url = "http://169.254.169.254/v1", key = "sk-third-key-0123456789"), v).status)
        val r = test(t)
        assertTrue(r.body.contains("Address not allowed"), r.body)
        assertTrue(r.body.contains(""""status":"failed""""), r.body)
    }

    private fun models(t: String, body: String) = client().api("POST", "/api/v1/admin/ai/models", body, t)

    @Test @Order(9) fun `the model list loads from an unsaved address, keeps the key server-side and never sends it to another host`() {
        val t = admin()
        assertEquals(200, put(t, json(key = KEY), version(get(t).body)).status)

        stub.seen.clear()
        val typed = models(t, """{"baseUrl":"${stub.baseUrl}","apiKey":"sk-typed-0123456789"}""")
        assertEquals(200, typed.status, typed.body)
        assertTrue(typed.body.contains(""""models":["dinov2-base","chat-sentinel"]"""), typed.body)
        assertTrue(stub.seen.single().contains("| Bearer sk-typed-0123456789 |"), stub.seen.toString())
        assertFalse(typed.body.contains("sk-typed-0123456789"))

        stub.seen.clear()
        assertEquals(200, models(t, """{"baseUrl":"${stub.baseUrl}"}""").status)
        assertTrue(stub.seen.single().contains("| Bearer $KEY |"), "same host reuses the stored key: ${stub.seen}")

        stub.seen.clear()
        val other = models(t, """{"baseUrl":"http://localhost:${stub.port}/v1"}""")
        assertEquals(200, other.status, other.body)
        assertTrue(stub.seen.single().contains("| null |"), "another host never gets the stored key: ${stub.seen}")
        assertFalse(stub.seen.toString().contains(KEY))
    }

    @Test @Order(10) fun `the model list refuses bad and metadata addresses without echoing them`() {
        val t = admin()
        val bad = models(t, """{"baseUrl":"ftp://leaky-host-sentinel/v1","apiKey":"sk-typed-0123456789"}""")
        assertEquals(422, bad.status, bad.body)
        assertTrue(bad.body.contains(""""field":"baseUrl","code":"invalid""""), bad.body)
        assertFalse(bad.body.contains("leaky-host-sentinel"))
        assertEquals(422, models(t, """{"baseUrl":"${stub.baseUrl}","apiKey":"has space"}""").status)

        val before = usageRows()
        val meta = models(t, """{"baseUrl":"http://169.254.169.254/v1","apiKey":"sk-typed-0123456789"}""")
        assertEquals(200, meta.status, meta.body)
        assertTrue(meta.body.contains(""""models":[]""") && meta.body.contains("Address not allowed"), meta.body)
        assertEquals(before + 1, usageRows())

        stub.mode = StubProvider.Mode.UNAUTHORIZED
        val denied = models(t, """{"baseUrl":"${stub.baseUrl}","apiKey":"sk-typed-0123456789"}""")
        stub.mode = StubProvider.Mode.OK
        assertTrue(denied.body.contains("Unauthorized") && !denied.body.contains("PROVIDER-SECRET-TEXT"), denied.body)
    }

    private fun withEmbed(url: String?, key: String?, base: String = json(key = null)) =
        base.replace(""""embeddingModel"""", """"embeddingBaseUrl":${url?.let { "\"$it\"" } ?: "null"},${key?.let { """"embeddingApiKey":"$it",""" } ?: ""}"embeddingModel"""")

    @Test @Order(11) fun `a separate embeddings address needs its own key, gets only embeddings, and its key stays write-only`() {
        val t = admin()
        val v0 = version(get(t).body)
        val noKey = put(t, withEmbed(embedStub.baseUrl, null), v0)
        assertEquals(422, noKey.status, noKey.body)
        assertTrue(noKey.body.contains(""""field":"embeddingApiKey","code":"required""""), noKey.body)

        val saved = put(t, withEmbed(embedStub.baseUrl, EMBED_KEY), v0)
        assertEquals(200, saved.status, saved.body)
        assertTrue(saved.body.contains(""""embeddingApiKeySet":true""") && saved.body.contains(""""embeddingBaseUrl":"${embedStub.baseUrl}""""), saved.body)
        assertFalse(saved.body.contains(EMBED_KEY) || get(t).body.contains(EMBED_KEY))
        assertFalse(String(jdbc.queryForObject("select embedding_api_key_ct from ai_setting", ByteArray::class.java)!!, Charsets.ISO_8859_1).contains(EMBED_KEY))

        stub.seen.clear(); embedStub.seen.clear()
        val r = test(t)
        assertTrue(r.body.contains(""""status":"connected""""), r.body)
        assertEquals(listOf("GET /v1/models"), stub.seen.map { it.substringBefore(" |") }, stub.seen.toString())
        assertEquals(listOf("POST /v1/embeddings"), embedStub.seen.map { it.substringBefore(" |") }, embedStub.seen.toString())
        assertTrue(embedStub.seen.single().contains("| Bearer $EMBED_KEY |") && stub.seen.none { it.contains(EMBED_KEY) }, "${stub.seen} ${embedStub.seen}")

        embedStub.seen.clear()
        assertEquals(200, models(t, """{"baseUrl":"${embedStub.baseUrl}","embedding":true}""").status)
        assertTrue(embedStub.seen.single().contains("| Bearer $EMBED_KEY |"), embedStub.seen.toString())
        embedStub.seen.clear()
        assertEquals(200, models(t, """{"baseUrl":"${embedStub.baseUrl}"}""").status)
        assertTrue(embedStub.seen.single().contains("| null |"), "the main key never goes to the embeddings host: ${embedStub.seen}")

        val kept = put(t, withEmbed(embedStub.baseUrl, null), version(get(t).body))
        assertTrue(kept.body.contains(""""embeddingApiKeySet":true"""), kept.body)
        val cleared = put(t, withEmbed(null, null), version(kept.body))
        assertEquals(200, cleared.status, cleared.body)
        assertTrue(cleared.body.contains(""""embeddingApiKeySet":false"""), cleared.body)
        stub.seen.clear()
        assertTrue(test(t).body.contains(""""status":"connected""""))
        assertTrue(stub.seen.any { it.startsWith("POST /v1/embeddings") }, "blank address: embeddings use the main provider ${stub.seen}")
    }
}
