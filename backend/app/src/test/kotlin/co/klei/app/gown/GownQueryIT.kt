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
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Story 5.1: the Gallery read side over Gowns written straight into the tables, so no AI provider is involved. */
@Testcontainers
@Import(RecordingMailConfig::class, GownQueryIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class GownQueryIT {
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
        val email = "gq-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        tx.execute { users.create("Gale Gallery", email, PW, rid, UserStatus.ACTIVE, true) }
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!
    }

    private fun post(token: String?, body: String) =
        UploadClient.call("POST", "$api/api/v1/gowns/query", token, body.toByteArray(), mapOf("Content-Type" to "application/json"))

    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject
    private fun names(r: UploadClient.Resp) = obj(r.text)["items"]!!.jsonArray.map { it.jsonObject["name"]!!.jsonPrimitive.content }

    private fun tag(type: TaxonomyType, value: String): UUID = tx.execute {
        em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.first { it.type == type && it.value == value }.id
    }!!

    private class Seeded(val gown: UUID, val photos: List<UUID>)

    private fun seed(name: String, ageDays: Long, silhouette: String, fabric: String, photos: Int): Seeded {
        val gownId = UUID.randomUUID()
        val at = Instant.now().minus(ageDays, ChronoUnit.DAYS)
        val ids = (0 until photos).map { UUID.randomUUID() }
        tx.execute {
            em.persist(Gown(gownId, name, "A gown", 90, at, ageDays == 0L, null, bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(at)), bidx.of(BidxDomain.IDEM, "save|$gownId")))
            em.flush()
            for (t in listOf(tag(TaxonomyType.SILHOUETTE, silhouette), tag(TaxonomyType.FABRIC, fabric))) em.persist(GownAttribute(UUID.randomUUID(), gownId, t))
            ids.forEachIndexed { i, pid ->
                val original = vault.put(Images.jpeg(80, 60))
                val thumb = vault.put(Images.solid(10 * i, 20, 30))
                val now = Instant.now()
                for (k in listOf(original, thumb)) em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, now))
                val p = Photo(pid, null, original.id, thumb.id, bidx.of(BidxDomain.IDEM, pid.toString()), "p$i.jpg", "image/jpeg", 1L, at.plusSeconds(i.toLong()))
                p.gownId = gownId
                em.persist(p)
            }
            em.flush()
        }
        return Seeded(gownId, ids)
    }

    private lateinit var ivy: Seeded
    private lateinit var oak: Seeded
    private lateinit var pine: Seeded

    @BeforeEach
    fun gowns() {
        jdbc.update("delete from photo where gown_id is not null")
        jdbc.update("delete from gown")
        seed("Quince", 100, "A-line", "Lace", 1)
        pine = seed("Pine", 45, "Ball gown", "Lace", 0)
        oak = seed("Oak", 20, "A-line", "Mikado", 5)
        seed("Maple", 3, "Mermaid", "Tulle", 1)
        ivy = seed("Ivy", 0, "A-line", "Lace", 2)
    }

    @Test fun `anonymous is refused, a Viewer may read, newest first with both counts and labels`() {
        assertEquals(401, post(null, "{}").status)
        val r = post(token(DefaultRoles.VIEWER), "{}")
        assertEquals(200, r.status, r.text)
        assertEquals(listOf("Ivy", "Maple", "Oak", "Pine", "Quince"), names(r))
        val o = obj(r.text)
        assertEquals(5, o["total"]!!.jsonPrimitive.content.toInt())
        assertEquals(5, o["matching"]!!.jsonPrimitive.content.toInt())
        assertTrue(o["next"]!!.toString() == "null")
        val items = o["items"]!!.jsonArray.map { it.jsonObject }
        val first = items[0]
        assertEquals(ivy.gown.toString(), first["id"]!!.jsonPrimitive.content)
        assertEquals(listOf("A-line"), first["silhouette"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(listOf("Lace"), first["fabric"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals("true", first["isNew"]!!.jsonPrimitive.content)
        assertEquals(2, first["photos"]!!.jsonPrimitive.content.toInt())
        assertEquals(ivy.photos.map { it.toString() }, first["thumbs"]!!.jsonArray.map { it.jsonPrimitive.content })
        val oakCard = items[2]
        assertEquals(5, oakCard["photos"]!!.jsonPrimitive.content.toInt())
        assertEquals(oak.photos.take(4).map { it.toString() }, oakCard["thumbs"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertEquals(0, items[3]["thumbs"]!!.jsonArray.size)
        assertEquals(pine.gown.toString(), items[3]["id"]!!.jsonPrimitive.content)
    }

    @Test fun `pages follow the cursor and every page keeps the same counts`() {
        val t = token(DefaultRoles.STAFF)
        val seen = mutableListOf<String>()
        var before: String? = null
        var pages = 0
        do {
            val r = post(t, """{"limit":2${before?.let { ",\"before\":$it" } ?: ""}}""")
            assertEquals(200, r.status, r.text)
            val o = obj(r.text)
            assertEquals(5, o["matching"]!!.jsonPrimitive.content.toInt())
            seen += names(r)
            before = o["next"]!!.takeIf { it.toString() != "null" }?.jsonPrimitive?.content
            pages++
        } while (before != null)
        assertEquals(listOf("Ivy", "Maple", "Oak", "Pine", "Quince"), seen)
        assertEquals(3, pages)
    }

    @Test fun `tags combine with AND across types and OR inside one type`() {
        val t = token(DefaultRoles.STAFF)
        val aline = tag(TaxonomyType.SILHOUETTE, "A-line")
        val lace = tag(TaxonomyType.FABRIC, "Lace")
        val tulle = tag(TaxonomyType.FABRIC, "Tulle")
        val mermaid = tag(TaxonomyType.SILHOUETTE, "Mermaid")
        val one = post(t, """{"silhouette":["$aline"]}""")
        assertEquals(listOf("Ivy", "Oak", "Quince"), names(one))
        assertEquals(3, obj(one.text)["matching"]!!.jsonPrimitive.content.toInt())
        assertEquals(5, obj(one.text)["total"]!!.jsonPrimitive.content.toInt())
        assertEquals(listOf("Ivy", "Quince"), names(post(t, """{"silhouette":["$aline"],"fabric":["$lace"]}""")))
        assertEquals(listOf("Ivy", "Maple", "Pine", "Quince"), names(post(t, """{"fabric":["$lace","$tulle"]}""")))
        assertEquals(listOf("Ivy", "Maple", "Oak", "Quince"), names(post(t, """{"silhouette":["$aline","$mermaid"]}""")))
        assertEquals(emptyList(), names(post(t, """{"silhouette":["$mermaid"],"fabric":["$lace"]}""")))
    }

    @Test fun `a fabric id used as a silhouette, or an unknown id, matches nothing instead of everything`() {
        val t = token(DefaultRoles.STAFF)
        val r = post(t, """{"silhouette":["${tag(TaxonomyType.FABRIC, "Lace")}"]}""")
        assertEquals(emptyList(), names(r))
        assertEquals(0, obj(r.text)["matching"]!!.jsonPrimitive.content.toInt())
        assertEquals(emptyList(), names(post(t, """{"fabric":["${UUID.randomUUID()}"]}""")))
    }

    @Test fun `the date window counts UTC days back from today`() {
        val t = token(DefaultRoles.STAFF)
        assertEquals(listOf("Ivy", "Maple"), names(post(t, """{"days":7}""")))
        assertEquals(listOf("Ivy", "Maple", "Oak"), names(post(t, """{"days":30}""")))
        assertEquals(listOf("Ivy", "Maple", "Oak", "Pine"), names(post(t, """{"days":90}""")))
        assertEquals(5, names(post(t, """{"days":0}""")).size)
        assertEquals(listOf("Oak"), names(post(t, """{"days":30,"silhouette":["${tag(TaxonomyType.SILHOUETTE, "A-line")}"],"fabric":["${tag(TaxonomyType.FABRIC, "Mikado")}"]}""")))
    }

    @Test fun `bad input is a 422 that names the field`() {
        val t = token(DefaultRoles.STAFF)
        for ((body, field) in listOf(
            """{"days":5}""" to "days", """{"limit":0}""" to "limit", """{"limit":101}""" to "limit", """{"before":0}""" to "before",
            """{"silhouette":[${(1..51).joinToString(",") { "\"${UUID.randomUUID()}\"" }}]}""" to "silhouette",
        )) {
            val r = post(t, body)
            assertEquals(422, r.status, r.text)
            assertTrue(r.text.contains("\"$field\""), r.text)
        }
        assertEquals(400, post(t, """{"silhouette":["not-an-id"]}""").status)
    }

    @Test fun `a Photo is served only through its own Gown, as a thumbnail or the original, never cached`() {
        val t = token(DefaultRoles.VIEWER)
        val pid = oak.photos[1]
        val url = "$api/api/v1/gowns/${oak.gown}/photos/$pid"
        assertEquals(401, UploadClient.call("GET", "$url?size=thumb", null).status)
        val thumb = UploadClient.call("GET", "$url?size=thumb", t)
        assertEquals(200, thumb.status)
        assertEquals("image/jpeg", thumb.header("Content-Type"))
        assertTrue(thumb.header("Cache-Control")!!.contains("no-store"))
        assertEquals("nosniff", thumb.header("X-Content-Type-Options"))
        assertTrue(thumb.body.size > 100)
        val full = UploadClient.call("GET", "$url?size=full", t)
        assertEquals(200, full.status)
        assertEquals("image/jpeg", full.header("Content-Type"))
        assertTrue(full.body.size > 100 && !thumb.body.contentEquals(full.body))
        assertContentEquals(thumb.body, UploadClient.call("GET", url, t).body)
        assertEquals(404, UploadClient.call("GET", "$api/api/v1/gowns/${ivy.gown}/photos/$pid?size=thumb", t).status)
        assertEquals(404, UploadClient.call("GET", "$api/api/v1/gowns/${oak.gown}/photos/${UUID.randomUUID()}?size=thumb", t).status)
        assertEquals(400, UploadClient.call("GET", "$url?size=huge", t).status)
    }

    @Test fun `one Gown reads with its tags by type, its Photos in upload order, confidence band and version`() {
        val t = token(DefaultRoles.VIEWER)
        assertEquals(401, UploadClient.call("GET", "$api/api/v1/gowns/${oak.gown}", null).status)
        val r = UploadClient.call("GET", "$api/api/v1/gowns/${oak.gown}", t)
        assertEquals(200, r.status, r.text)
        val o = obj(r.text)
        assertEquals("Oak", o["name"]!!.jsonPrimitive.content)
        assertEquals("A gown", o["description"]!!.jsonPrimitive.content)
        assertEquals(90, o["confidence"]!!.jsonPrimitive.content.toInt())
        assertEquals("high", o["band"]!!.jsonPrimitive.content)
        assertEquals(5, o["photoCount"]!!.jsonPrimitive.content.toInt())
        assertTrue(o["version"]!!.jsonPrimitive.content.toLong() >= 0)
        assertEquals(oak.photos.map { it.toString() }, o["photos"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content })
        val tags = o["attributes"]!!.jsonArray.associate { it.jsonObject["type"]!!.jsonPrimitive.content to it.jsonObject["values"]!!.jsonArray.map { v -> v.jsonPrimitive.content } }
        assertEquals(mapOf("silhouette" to listOf("A-line"), "fabric" to listOf("Mikado")), tags)
        val none = obj(UploadClient.call("GET", "$api/api/v1/gowns/${pine.gown}", t).text)
        assertEquals(0, none["photos"]!!.jsonArray.size)
        assertEquals(404, UploadClient.call("GET", "$api/api/v1/gowns/${UUID.randomUUID()}", t).status)
        assertEquals(400, UploadClient.call("GET", "$api/api/v1/gowns/not-an-id", t).status)
    }

    @Test fun `a swapped Photo object fails with crypto_failure, not with data`() {
        val t = token(DefaultRoles.VIEWER)
        fun original(id: UUID) = jdbc.queryForObject("select original_object_id from photo where id = ?", UUID::class.java, id)!!
        val a = original(oak.photos[0]); val b = original(oak.photos[1])
        val bodyA = store.objects[a]!!; val bodyB = store.objects[b]!!
        val url = "$api/api/v1/gowns/${oak.gown}/photos/${oak.photos[0]}?size=full"
        try {
            store.objects[a] = bodyB; store.objects[b] = bodyA
            val r = UploadClient.call("GET", url, t)
            assertEquals(500, r.status)
            assertTrue(r.text.contains("crypto_failure"), r.text)
        } finally {
            store.objects[a] = bodyA; store.objects[b] = bodyB
        }
        assertEquals(200, UploadClient.call("GET", url, t).status)
    }

    @Test fun `reading the Gallery writes no audit entry`() {
        val before = jdbc.queryForObject("select count(*) from audit_entry", Int::class.java)
        val t = token(DefaultRoles.STAFF)
        post(t, """{"silhouette":["${tag(TaxonomyType.SILHOUETTE, "A-line")}"]}""")
        assertEquals(before, jdbc.queryForObject("select count(*) from audit_entry", Int::class.java))
    }
}
