package co.klei.app.web

import co.klei.app.TestSupport
import co.klei.app.identity.UserService
import co.klei.app.security.PermissionEpoch
import co.klei.core.storage.ObjectStorePort
import co.klei.crypto.TokenClaims
import co.klei.crypto.TokenSigner
import io.swagger.v3.core.util.Json
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.test.context.bean.override.mockito.MockitoBean
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The committed contract must equal what springdoc generates. After an intended API change, regenerate with
 * `./mvnw verify -Dklei.openapi.write=true` and commit `docs/api/openapi.json`.
 */
@Testcontainers
@SpringBootTest(webEnvironment = RANDOM_PORT)
class OpenApiIT {
    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private val committed: Path = Path.of("../../docs/api/openapi.json")

        @DynamicPropertySource @JvmStatic
        fun props(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { pg.jdbcUrl }
            r.add("spring.datasource.username") { pg.username }
            r.add("spring.datasource.password") { pg.password }
            r.add("klei.auth-port") { authPort }
            r.add("springdoc.api-docs.enabled") { true }
            TestSupport.keys(r)
            TestSupport.bootstrap(r)
            TestSupport.s3(r)
        }
    }

    @MockitoBean lateinit var store: ObjectStorePort
    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var tokens: TokenSigner
    @Autowired lateinit var epoch: PermissionEpoch
    @Autowired lateinit var users: UserService
    @Autowired lateinit var tx: TransactionTemplate

    private fun generated(): String {
        val id = tx.execute { users.find(TestSupport.ADMIN_EMAIL)!!.id }!!
        val now = Instant.now().epochSecond
        val token = tokens.sign(TokenClaims(id.toString(), emptyList(), UUID.randomUUID().toString(), epoch.current(), now, now + 900))
        val r = HttpClient.newHttpClient().send(
            HttpRequest.newBuilder(URI.create("http://127.0.0.1:${ctx.webServer!!.port}/v3/api-docs")).header("Authorization", "Bearer $token").build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        assertEquals(200, r.statusCode(), r.body())
        return Json.pretty(Json.mapper().readTree(r.body())) + "\n"
    }

    @Test fun `committed openapi json equals the generated spec`() {
        val spec = generated()
        if (System.getProperty("klei.openapi.write") == "true") {
            Files.createDirectories(committed.parent)
            Files.writeString(committed, spec)
        }
        assertTrue(Files.exists(committed), "run ./mvnw verify -Dklei.openapi.write=true and commit docs/api/openapi.json")
        assertEquals(Files.readString(committed), spec, "docs/api/openapi.json is out of date")
    }

    @Test fun `every problem code has a fixed extensions schema and the probe paths are not published`() {
        val spec = generated()
        ProblemCode.entries.forEach { assertTrue(spec.contains("\"Extensions_${it.code}\""), it.code) }
        assertTrue(spec.contains("\"/api/v1/me\""))
        assertTrue(!spec.contains("/probe/") && !spec.contains("/boom/"))
    }
}
