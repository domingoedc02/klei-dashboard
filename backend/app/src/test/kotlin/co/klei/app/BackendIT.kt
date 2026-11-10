package co.klei.app

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import co.klei.core.storage.ObjectStorePort
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import org.mockito.Mockito.`when`
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@Testcontainers
@SpringBootTest(webEnvironment = RANDOM_PORT)
class BackendIT {
    companion object {
        @Container
        @JvmStatic
        val pg = PostgreSQLContainer("postgres:18.6")

        private val authPort = ServerSocket(0).use { it.localPort }

        @DynamicPropertySource
        @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @MockitoBean lateinit var store: ObjectStorePort
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var ctx: ServletWebServerApplicationContext

    private val http = HttpClient.newHttpClient()
    private val logs = ListAppender<ILoggingEvent>()
    private val root = LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME) as Logger

    private val apiPort get() = ctx.webServer!!.port

    @BeforeEach fun capture() { logs.start(); root.addAppender(logs) }
    @AfterEach fun release() { root.detachAppender(logs); logs.stop() }

    private fun get(port: Int, path: String): HttpResponse<String> =
        http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:$port$path")).build(), HttpResponse.BodyHandlers.ofString())

    private fun assertProblem(r: HttpResponse<String>, status: Int, code: String) {
        assertEquals(status, r.statusCode())
        assertTrue(r.headers().firstValue("content-type").orElse("").startsWith("application/problem+json"))
        assertTrue(Regex("""\{"type":"[^"]+","title":"[^"]+","status":$status,"code":"$code","correlationId":"[0-9a-f-]{36}"\}""").matches(r.body()), r.body())
    }

    @Test fun `health answers up on both ports`() {
        for (p in listOf(apiPort, authPort)) {
            val r = get(p, "/health")
            assertEquals(200, r.statusCode())
            assertEquals("""{"status":"up"}""", r.body())
        }
    }

    @Test fun `ready is 200 when database and bucket answer`() {
        `when`(store.isReachable()).thenReturn(true)
        assertEquals(200, get(apiPort, "/health/ready").statusCode())
    }

    @Test fun `ready is 503 unavailable when the bucket is down`() {
        `when`(store.isReachable()).thenReturn(false)
        assertProblem(get(apiPort, "/health/ready"), 503, "unavailable")
    }

    @Test fun `port guard hides each surface on the other port`() {
        assertProblem(get(authPort, "/api/v1/gowns"), 404, "not_found")
        assertProblem(get(apiPort, "/login"), 404, "not_found")
    }

    // Deny by default: an unknown API path without a token is 401, so the path space reveals nothing.
    @Test fun `unknown path without a token is a bare 401`() = assertProblem(get(apiPort, "/api/v1/nope"), 401, "unauthenticated")

    @Test fun `unhandled exception is a bare 500 and nothing leaks`() {
        val r = get(apiPort, "/api/v1/boom/abc")
        assertProblem(r, 500, "internal")
        assertFalse(r.body().contains("SENTINEL"))
        assertFalse(logs.list.any { it.formattedMessage.contains("SENTINEL") || it.throwableProxy != null })
    }

    @Test fun `access log holds method status duration and id only`() {
        get(apiPort, "/api/v1/gowns/SENTINEL-path-9?q=SENTINEL-query-9")
        // The filter logs after the response is sent, so the line can trail the client by a moment.
        val end = System.nanoTime() + 5_000_000_000
        while (logs.list.none { it.loggerName == "klei.access" } && System.nanoTime() < end) Thread.sleep(20)
        val access = logs.list.filter { it.loggerName == "klei.access" }
        assertEquals(1, access.size)
        assertTrue(Regex("""method=GET status=\d+ durationMs=\d+ correlationId=[0-9a-f-]{36}""").matches(access[0].formattedMessage))
        assertFalse(logs.list.any { it.formattedMessage.contains("SENTINEL") })
    }

    @Test fun `flyway applied every migration and only the identity tables exist`() {
        assertEquals(21, jdbc.queryForObject("select count(*) from flyway_schema_history where version in ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21') and success", Int::class.java))
        val tables = jdbc.queryForList("select table_name from information_schema.tables where table_schema = 'public' order by 1", String::class.java)
        assertEquals(listOf("ai_setting", "ai_usage", "app_user", "attachment", "audit_entry", "auth_credential", "away", "away_sent", "chat_message", "client", "data_key", "draft", "embedding", "flyway_schema_history", "gown", "gown_attribute", "gown_term", "inquiry", "inquiry_term", "message", "notification", "notification_digest", "permission_epoch", "photo", "recovery_code", "refresh_token", "role", "role_permission", "signature", "stored_object", "taxonomy_value", "upload_batch", "upload_group", "user_totp", "workspace"), tables)
    }

    @Test fun `schema allowlist - no column can hold a business value in the clear`() {
        val bad = SchemaAllowlist.violations(jdbc)
        assertTrue(bad.isEmpty(), bad.toString())
    }

    @Test fun `startup stored one wrapped data key`() {
        assertEquals(1, jdbc.queryForObject("select count(*) from data_key where generation = 1 and kek_version = 1", Int::class.java))
    }
}
