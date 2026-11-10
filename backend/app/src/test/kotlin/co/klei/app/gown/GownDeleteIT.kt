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

/** Story 5.5: deleting Gowns, rows and bucket objects, over Gowns written straight into the tables. */
@Testcontainers
@Import(RecordingMailConfig::class, GownDeleteIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class GownDeleteIT {
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
    @Autowired lateinit var sweep: co.klei.app.upload.ObjectSweepJob
    @Autowired lateinit var terms: TermIndexer
    @Autowired lateinit var audit: co.klei.app.identity.AuditService
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

    private fun delete(token: String?, body: String) =
        UploadClient.call("POST", "$api/api/v1/gowns/delete", token, body.toByteArray(), mapOf("Content-Type" to "application/json"))

    private fun ids(vararg g: UUID) = g.joinToString(",", "[", "]") { "\"$it\"" }
    private fun count(table: String) = jdbc.queryForObject("select count(*) from $table", Int::class.java)!!
    private fun deleted() = tx.execute { audit.all().filter { it.action == "gown_deleted" }.map { it.detail } }!!

    @BeforeEach
    fun clean() {
        store.failDeletes = false
        jdbc.update("delete from embedding")
        jdbc.update("delete from photo where gown_id is not null")
        jdbc.update("delete from gown")
        jdbc.update("delete from stored_object")
        store.objects.clear()
    }

    @Test fun `only a Role with the delete Permission may, and ids are required and capped`() {
        val g = seed("Oak", 3, "A-line", "Lace", 1)
        assertEquals(401, delete(null, """{"ids":${ids(g.gown)}}""").status)
        for (role in listOf(DefaultRoles.VIEWER, DefaultRoles.STAFF)) assertEquals(403, delete(token(role), """{"ids":${ids(g.gown)}}""").status, role)
        assertTrue(tx.execute { audit.all().any { it.action == "forbidden" && it.detail?.contains("POST /api/v1/gowns/delete") == true } }!!, "the 403 writes its own Audit Entry")
        assertEquals(1, count("gown"))
        val admin = token(DefaultRoles.ADMIN)
        for (body in listOf("{}", """{"ids":[]}""")) assertEquals(422, delete(admin, body).status, body)
        val many = (1..101).map { UUID.randomUUID() }.toTypedArray()
        assertEquals(422, delete(admin, """{"ids":${ids(*many)}}""").status)
        assertEquals(1, count("gown"))
    }

    @Test fun `deleting removes the Gown, its Photos, tags, words and both bucket objects, leaves the others, and audits counts and names`() {
        val oak = seed("Oak", 3, "A-line", "Lace", 2)
        val elm = seed("Elm", 2, "Mermaid", "Tulle", 1)
        tx.execute { terms.reindex(listOf(em.find(Gown::class.java, oak.gown)!!, em.find(Gown::class.java, elm.gown)!!)) }
        assertEquals(6, store.objects.size)
        val ghost = UUID.randomUUID()
        val admin = token(DefaultRoles.ADMIN)
        val before = deleted()

        val r = delete(admin, """{"ids":${ids(oak.gown, ghost, oak.gown)}}""")
        assertEquals(200, r.status, r.text)
        val o = obj(r.text)
        assertEquals(1, o["deleted"]!!.jsonPrimitive.content.toInt())
        assertEquals(listOf(ghost.toString()), o["missing"]!!.jsonArray.map { it.jsonPrimitive.content })

        assertEquals(1, count("gown"))
        assertEquals(1, count("photo where gown_id is not null"))
        assertEquals(0, jdbc.queryForObject("select count(*) from gown_term where gown_id = ?", Int::class.java, oak.gown))
        assertEquals(0, jdbc.queryForObject("select count(*) from gown_attribute where gown_id = ?", Int::class.java, oak.gown))
        assertEquals(2, count("stored_object"))
        assertEquals(2, store.objects.size, "bucket holds only the other Gown's objects")
        assertTrue(jdbc.queryForObject("select count(*) from gown_term where gown_id = ?", Int::class.java, elm.gown)!! > 0)

        val staff = token(DefaultRoles.STAFF)
        assertEquals(404, UploadClient.call("GET", "$api/api/v1/gowns/${oak.gown}", staff).status)
        assertEquals(404, UploadClient.call("GET", "$api/api/v1/gowns/${oak.gown}/photos/${oak.photos[0]}?size=thumb", staff).status)
        val listed = obj(UploadClient.call("POST", "$api/api/v1/gowns/query", staff, "{}".toByteArray(), mapOf("Content-Type" to "application/json")).text)["items"]!!.jsonArray
        assertEquals(1, listed.size)

        val detail = deleted().toMutableList().also { all -> before.forEach { all.remove(it) } }.single()!!
        assertTrue(detail.startsWith("gowns=1 photos=2 names=Oak"), detail)
    }

    @Test fun `a bucket failure still deletes the rows, and the nightly sweep removes the leftover objects`() {
        val oak = seed("Oak", 3, "A-line", "Lace", 2)
        store.failDeletes = true
        assertEquals(200, delete(token(DefaultRoles.ADMIN), """{"ids":${ids(oak.gown)}}""").status)
        assertEquals(0, count("gown"))
        assertEquals(0, count("photo where gown_id is not null"))
        assertEquals(4, store.objects.size, "objects outlive the failed delete")
        store.failDeletes = false
        val swept = sweep.sweep(Instant.now().plus(co.klei.app.upload.ObjectSweepJob.GRACE).plusSeconds(60))
        assertEquals(4, swept.objects)
        assertEquals(0, store.objects.size)
    }
}
