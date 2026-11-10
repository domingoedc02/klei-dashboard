package co.klei.app.search

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.gown.Gown
import co.klei.app.gown.GownAttribute
import co.klei.app.gown.TermIndexer
import co.klei.app.identity.Role
import co.klei.app.identity.RolePermission
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.taxonomy.TaxonomyValue
import co.klei.app.upload.FakeStore
import co.klei.app.upload.Images
import co.klei.app.upload.ObjectVault
import co.klei.app.upload.Photo
import co.klei.app.upload.StoredObject
import co.klei.app.upload.UploadClient
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.Permission
import co.klei.core.identity.UserStatus
import co.klei.core.taxonomy.TaxonomyType
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.DayBucket
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
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
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Story 8.2: whole-word search over the blind term indexes, with the Role split between Gowns and Inquiries. */
@Testcontainers
@Import(RecordingMailConfig::class, SearchIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class SearchIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Search-pass-1"
        private val signed = mutableMapOf<String, String>()

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
    @Autowired lateinit var bidx: BlindIndex
    @Autowired lateinit var terms: TermIndexer
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun tokenFor(roleId: UUID): String {
        val email = "se-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Sera Search", email, PW, roleId, UserStatus.ACTIVE, true) }
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!
    }
    private fun token(role: String) = tokenFor(roles.roles().first { it.name == role }.id)
    private fun roleOf(name: String, vararg perms: Permission): UUID {
        val id = UUID.randomUUID()
        tx.execute { em.persist(Role(id, name)); em.flush(); perms.forEach { em.persist(RolePermission(UUID.randomUUID(), id, it)) } }
        return id
    }

    private fun json(method: String, path: String, token: String?, body: String? = null, version: Long? = null) =
        UploadClient.call(
            method, "$api$path", token, body?.toByteArray(),
            buildMap { if (body != null) put("Content-Type", "application/json"); if (version != null) put("If-Match", version.toString()) },
        )
    private fun search(token: String?, q: String) = json("POST", "/api/v1/search", token, """{"q":${Json.encodeToString(kotlinx.serialization.serializer<String>(), q)}}""")
    private fun hits(token: String, q: String) = Json.parseToJsonElement(search(token, q).text).jsonObject["items"]!!.jsonArray.map { it.jsonObject }
    private fun titles(token: String, q: String) = hits(token, q).map { it["kind"]!!.jsonPrimitive.content + ":" + it["title"]!!.jsonPrimitive.content }

    private fun tag(type: TaxonomyType, value: String): UUID = tx.execute {
        em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.first { it.type == type && it.value == value }.id
    }!!

    private fun seed(name: String, silhouette: String, fabric: String): UUID {
        val gownId = UUID.randomUUID()
        val at = Instant.now().minus(3, ChronoUnit.DAYS)
        tx.execute {
            em.persist(Gown(gownId, name, "A gown", 90, at, true, null, bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(at)), bidx.of(BidxDomain.IDEM, "save|$gownId")))
            em.flush()
            for (t in listOf(tag(TaxonomyType.SILHOUETTE, silhouette), tag(TaxonomyType.FABRIC, fabric))) em.persist(GownAttribute(UUID.randomUUID(), gownId, t))
            em.flush()
        }
        tx.execute { terms.reindex(listOf(em.find(Gown::class.java, gownId)!!)) }
        return gownId
    }

    private fun inquire(token: String, name: String, subject: String) {
        val r = json("POST", "/api/v1/inquiries", token, """{"clientName":"$name","clientEmail":"se-${UUID.randomUUID()}@example.test","subject":"$subject","body":"Hello"}""")
        assertEquals(201, r.status, r.text)
    }

    // One set of tokens per class: the test instance is new for each test, the sign-ins are not.
    private val admin get() = signed.getValue("admin")
    private val staff get() = signed.getValue("staff")
    private val viewer get() = signed.getValue("viewer")
    private val replyOnly get() = signed.getValue("replyOnly")
    private val neither get() = signed.getValue("neither")

    @BeforeEach
    fun seeded() {
        if (signed.isEmpty()) {
            signed["admin"] = token(DefaultRoles.ADMIN); signed["staff"] = token(DefaultRoles.STAFF); signed["viewer"] = token(DefaultRoles.VIEWER)
            signed["replyOnly"] = tokenFor(roleOf("Mailer", Permission.PERM_REPLY))
            signed["neither"] = tokenFor(roleOf("Uploader", Permission.PERM_UPLOAD_IMAGES))
        }
        jdbc.update("delete from gown")
        jdbc.update("delete from inquiry")
        jdbc.update("delete from client")
        seed("Magnolia", "A-line", "Lace")
        seed("Willow Dream", "Mermaid", "Tulle")
        inquire(staff, "Magnolia Fontaine", "Veil question")
        inquire(staff, "Priya Nair", "Fitting in June")
    }

    @Test fun `sign-in and a Permission are required, and the answer has a stable shape`() {
        assertEquals(401, search(null, "magnolia").status)
        assertEquals(403, search(neither, "magnolia").status)
        assertEquals(422, json("POST", "/api/v1/search", staff, "{}").status)
        assertEquals(422, search(staff, "x".repeat(201)).status)
        assertEquals(emptyList(), titles(staff, "   !!! "))
    }

    @Test fun `Gowns come first, whole words only, any case, every word must match`() {
        assertEquals(listOf("gown:Magnolia", "inquiry:Magnolia Fontaine"), titles(staff, "MAGNOLIA"))
        assertEquals(emptyList(), titles(staff, "magnol"), "no prefix match")
        assertEquals(emptyList(), titles(staff, "olia"), "no substring match")
        assertEquals(listOf("gown:Magnolia"), titles(staff, "magnolia lace"))
        assertEquals(listOf("gown:Willow Dream"), titles(staff, "mermaid, tulle"))
        assertEquals(emptyList(), titles(staff, "magnolia tulle"))
        assertEquals(listOf("inquiry:Priya Nair"), titles(staff, "fitting JUNE"))
    }

    @Test fun `a Gown hit carries its labels and thumbs, an Inquiry hit its subject`() {
        val g = hits(staff, "willow").single()
        assertEquals("gown", g["kind"]!!.jsonPrimitive.content)
        assertEquals("Mermaid, Tulle", g["subtitle"]!!.jsonPrimitive.content)
        assertEquals(0, g["thumbs"]!!.jsonArray.size)
        val i = hits(staff, "priya").single()
        assertEquals("Fitting in June", i["subtitle"]!!.jsonPrimitive.content)
    }

    @Test fun `each kind needs its own Permission and the shape does not change`() {
        assertEquals(listOf("gown:Magnolia"), titles(viewer, "magnolia"))
        assertEquals(listOf("inquiry:Magnolia Fontaine"), titles(replyOnly, "magnolia"))
        assertEquals(2, titles(admin, "magnolia").size)
    }

    @Test fun `at most six results, Gowns first`() {
        repeat(5) { seed("Pearl $it", "A-line", "Lace") }
        repeat(3) { inquire(staff, "Pearl Client $it", "Pearl question") }
        val t = titles(staff, "pearl")
        assertEquals(6, t.size)
        assertEquals(5, t.count { it.startsWith("gown:") })
    }

    @Test fun `a renamed Gown matches the new word and not the old one`() {
        val id = seed("Birch", "A-line", "Lace")
        assertEquals(listOf("gown:Birch"), titles(staff, "birch"))
        val v = Json.parseToJsonElement(json("GET", "/api/v1/gowns/$id", staff).text).jsonObject["version"]!!.jsonPrimitive.content.toLong()
        assertEquals(200, json("PATCH", "/api/v1/gowns/$id", staff, """{"name":"Spruce"}""", v).status)
        assertEquals(emptyList(), titles(staff, "birch"))
        assertEquals(listOf("gown:Spruce"), titles(staff, "spruce"))
    }

    @Test fun `the search term is never stored in the clear`() {
        titles(staff, "zebrawordzq")
        val dump = jdbc.queryForList("select table_name from information_schema.tables where table_schema = 'public'", String::class.java)
        assertTrue(dump.isNotEmpty())
        assertEquals(0, jdbc.queryForObject("select count(*) from audit_entry where encode(detail_ct, 'escape') like '%zebrawordzq%'", Int::class.java))
    }
}
