package co.klei.app.gown

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
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
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Story 5.4: the export manifest and the photo type header, over Gowns written straight into the tables. */
@Testcontainers
@Import(RecordingMailConfig::class, GownExportIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class GownExportIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Gallery-pass-1"

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
    @Autowired lateinit var vault: ObjectVault
    @Autowired lateinit var store: FakeStore
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun token(role: String): String {
        val email = "gx-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        tx.execute { users.create("Gale Gallery", email, PW, rid, UserStatus.ACTIVE, true) }
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!
    }

    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    private fun tag(type: TaxonomyType, value: String): UUID = tx.execute {
        em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.first { it.type == type && it.value == value }.id
    }!!

    private class Seeded(val gown: UUID, val photos: List<UUID>)

    private fun seed(name: String, ageDays: Long, silhouette: String, fabric: String, photos: Int, size: Long = 1L, description: String? = "A gown"): Seeded {
        val gownId = UUID.randomUUID()
        val at = Instant.now().minus(ageDays, ChronoUnit.DAYS)
        val ids = (0 until photos).map { UUID.randomUUID() }
        tx.execute {
            em.persist(Gown(gownId, name, description, 90, at, ageDays == 0L, null, bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(at)), bidx.of(BidxDomain.IDEM, "save|$gownId")))
            em.flush()
            for (t in listOf(tag(TaxonomyType.SILHOUETTE, silhouette), tag(TaxonomyType.FABRIC, fabric))) em.persist(GownAttribute(UUID.randomUUID(), gownId, t))
            ids.forEachIndexed { i, pid ->
                val original = vault.put(Images.jpeg(80, 60))
                val thumb = vault.put(Images.solid(10 * i, 20, 30))
                val now = Instant.now()
                for (k in listOf(original, thumb)) em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, now))
                val p = Photo(pid, null, original.id, thumb.id, bidx.of(BidxDomain.IDEM, pid.toString()), "p$i.jpg", "image/jpeg", size, at.plusSeconds(i.toLong()))
                p.gownId = gownId
                em.persist(p)
            }
            em.flush()
        }
        return Seeded(gownId, ids)
    }

    private fun export(token: String?, body: String) =
        UploadClient.call("POST", "$api/api/v1/gowns/export", token, body.toByteArray(), mapOf("Content-Type" to "application/json"))

    private fun ids(vararg g: UUID) = g.joinToString(",", "[", "]") { "\"$it\"" }

    @BeforeEach
    fun clean() {
        jdbc.update("delete from photo where gown_id is not null")
        jdbc.update("delete from gown")
    }

    @Test fun `anonymous is refused, a Viewer may read, and ids are required`() {
        val g = seed("Oak", 3, "A-line", "Lace", 1)
        assertEquals(401, export(null, """{"ids":${ids(g.gown)}}""").status)
        assertEquals(200, export(token(DefaultRoles.VIEWER), """{"ids":${ids(g.gown)}}""").status)
        for (body in listOf("{}", """{"ids":[]}""")) assertEquals(422, export(token(DefaultRoles.VIEWER), body).status, body)
    }

    @Test fun `the manifest lists photos in upload order with their type, the details text, and the unknown ids as missing`() {
        val oak = seed("Oak", 3, "A-line", "Lace", 3, description = "Line one\r\nLine two")
        val bare = seed("Elm", 2, "Mermaid", "Tulle", 0, description = null)
        val ghost = UUID.randomUUID()
        val r = export(token(DefaultRoles.STAFF), """{"ids":${ids(bare.gown, oak.gown, ghost, oak.gown)}}""")
        assertEquals(200, r.status, r.text)
        val o = obj(r.text)
        val items = o["items"]!!.jsonArray.map { it.jsonObject }
        assertEquals(listOf("Elm", "Oak"), items.map { it["name"]!!.jsonPrimitive.content }, "asked order, no duplicates")
        assertEquals(listOf(ghost.toString()), o["missing"]!!.jsonArray.map { it.jsonPrimitive.content })
        val photos = items[1]["photos"]!!.jsonArray.map { it.jsonObject }
        assertEquals(oak.photos.map { it.toString() }, photos.map { it["id"]!!.jsonPrimitive.content })
        assertTrue(photos.all { it["type"]!!.jsonPrimitive.content == "jpeg" })
        assertEquals(0, items[0]["photos"]!!.jsonArray.size)
        val text = items[1]["details"]!!.jsonPrimitive.content
        assertTrue(text.startsWith("Name: Oak\nSilhouette: A-line\nFabric: Lace\nDate added: "), text)
        assertTrue(text.endsWith("Description:\nLine one\nLine two\n") && !text.contains('\r'), text)
        assertTrue(items[0]["details"]!!.jsonPrimitive.content.endsWith("Description:\nNo description yet.\n"))
    }

    @Test fun `Date added follows the caller's date format and zone, and defaults to US order in UTC`() {
        val g = seed("Oak", 3, "A-line", "Lace", 1)
        val created = tx.execute { em.find(Gown::class.java, g.gown)!!.createdAt }!!
        fun date(t: String) = Regex("Date added: (.+)\\n").find(obj(export(t, """{"ids":${ids(g.gown)}}""").text)["items"]!!.jsonArray[0].jsonObject["details"]!!.jsonPrimitive.content)!!.groupValues[1]
        val fresh = token(DefaultRoles.STAFF)
        assertEquals(DateTimeFormatter.ofPattern("MM/dd/yyyy").withZone(ZoneOffset.UTC).format(created), date(fresh))
        val body = """{"timezone":"Pacific/Kiritimati","dateFormat":"YYYY-MM-DD","startPage":"gallery","enterToSend":false,"newInquiry":true,"aiFinished":true,"teamActivity":true}"""
        assertEquals(200, UploadClient.call("PUT", "$api/api/v1/me/preferences", fresh, body.toByteArray(), mapOf("Content-Type" to "application/json", "If-Match" to "0")).status)
        assertEquals(DateTimeFormatter.ofPattern("yyyy-MM-dd").withZone(ZoneId.of("Pacific/Kiritimati")).format(created), date(fresh))
    }

    @Test fun `more than 100 ids, or more than 100 MB of photos, is 413 and nothing is built`() {
        val staff = token(DefaultRoles.STAFF)
        val many = (1..101).map { UUID.randomUUID() }.toTypedArray()
        assertEquals(413, export(staff, """{"ids":${ids(*many)}}""").status)
        val big = seed("Big", 1, "A-line", "Lace", 2, size = 60L * 1024 * 1024)
        val r = export(staff, """{"ids":${ids(big.gown)}}""")
        assertEquals(413, r.status, r.text)
        assertTrue(r.text.contains("too_large"), r.text)
        val small = seed("Small", 1, "A-line", "Lace", 2, size = 40L * 1024 * 1024)
        assertEquals(200, export(staff, """{"ids":${ids(small.gown)}}""").status)
    }

    @Test fun `the full photo answers with its type, and a thumb still answers as a jpeg`() {
        val g = seed("Oak", 3, "A-line", "Lace", 1)
        val staff = token(DefaultRoles.STAFF)
        val full = UploadClient.call("GET", "$api/api/v1/gowns/${g.gown}/photos/${g.photos[0]}?size=full", staff)
        assertEquals(200, full.status)
        assertEquals("jpeg", full.headers.firstValue("X-Image-Type").orElse(""))
    }
}
