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

/** Story 5.3: editing a saved Gown, optimistic locking, term rewrites and the Taxonomy rename, with Gowns written straight into the tables. */
@Testcontainers
@Import(RecordingMailConfig::class, GownEditIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class GownEditIT {
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
    @Autowired lateinit var audit: co.klei.app.identity.AuditService
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun token(role: String): String {
        val email = "ge-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        tx.execute { users.create("Gale Gallery", email, PW, rid, UserStatus.ACTIVE, true) }
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!
    }

    private fun call(method: String, path: String, token: String?, body: String? = null, version: Long? = null) =
        UploadClient.call(
            method, "$api$path", token, body?.toByteArray(),
            buildMap { if (body != null) put("Content-Type", "application/json"); if (version != null) put("If-Match", version.toString()) },
        )

    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject
    private fun version(id: UUID, token: String) = obj(call("GET", "/api/v1/gowns/$id", token).text)["version"]!!.jsonPrimitive.content.toLong()
    private fun patch(id: UUID, token: String, body: String, version: Long? = version(id, token)) = call("PATCH", "/api/v1/gowns/$id", token, body, version)
    private fun terms(id: UUID) = jdbc.queryForObject("select count(*) from gown_term where gown_id = ?", Int::class.java, id)!!
    private fun has(id: UUID, word: String) =
        jdbc.queryForObject("select count(*) from gown_term where gown_id = ? and term_bidx = ?", Int::class.java, id, bidx.of(BidxDomain.GOWN_TERM, word))!! == 1

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

    @Autowired lateinit var terms: TermIndexer
    private lateinit var admin: String
    private lateinit var staff: String
    private lateinit var viewer: String
    private lateinit var oak: UUID

    private fun edited() = tx.execute { audit.all().filter { it.action == "gown_edited" }.map { it.detail } }!!
    private var audited = 0

    @BeforeEach
    fun gowns() {
        audited = edited().size
        jdbc.update("delete from gown")
        oak = seed("Oak", "A-line", "Lace")
        if (!::admin.isInitialized) { admin = token(DefaultRoles.ADMIN); staff = token(DefaultRoles.STAFF); viewer = token(DefaultRoles.VIEWER) }
    }

    private fun tags(vararg pairs: Pair<String, String>) = pairs.joinToString(",", "[", "]") { """{"type":"${it.first}","value":"${it.second}"}""" }

    @Test fun `only a holder of Edit gown details may patch, and the version is required`() {
        val body = """{"name":"Elm"}"""
        assertEquals(401, call("PATCH", "/api/v1/gowns/$oak", null, body, 0).status)
        assertEquals(403, call("PATCH", "/api/v1/gowns/$oak", viewer, body, 0).status)
        assertEquals(400, call("PATCH", "/api/v1/gowns/$oak", staff, body).status)
        assertEquals(404, call("PATCH", "/api/v1/gowns/${UUID.randomUUID()}", staff, body, 0).status)
        assertEquals("Oak", obj(call("GET", "/api/v1/gowns/$oak", staff).text)["name"]!!.jsonPrimitive.content)
    }

    @Test fun `a rename answers with the new Gown and version, rewrites the words, keeps New and the day, and audits no value`() {
        val before = version(oak, staff)
        val day = jdbc.queryForObject("select day_bidx from gown where id = ?", ByteArray::class.java, oak)!!
        assertTrue(has(oak, "oak") && has(oak, "lace") && has(oak, "line"))
        val r = patch(oak, staff, """{"name":"  Cedar Rose  "}""")
        assertEquals(200, r.status, r.text)
        val o = obj(r.text)
        assertEquals("Cedar Rose", o["name"]!!.jsonPrimitive.content)
        assertEquals(before + 1, o["version"]!!.jsonPrimitive.content.toLong())
        assertEquals("A gown", o["description"]!!.jsonPrimitive.content)
        assertTrue(!has(oak, "oak") && has(oak, "cedar") && has(oak, "rose") && has(oak, "lace") && has(oak, "line"))
        assertContentEquals(day, jdbc.queryForObject("select day_bidx from gown where id = ?", ByteArray::class.java, oak)!!)
        val card = obj(UploadClient.call("POST", "$api/api/v1/gowns/query", staff, "{}".toByteArray(), mapOf("Content-Type" to "application/json")).text)["items"]!!.jsonArray.first().jsonObject
        assertEquals("true", card["isNew"]!!.jsonPrimitive.content)
        val entries = edited()
        assertEquals(audited + 1, entries.size)
        assertTrue("fields=name" in entries && entries.none { it?.contains("Cedar") == true })
    }

    @Test fun `a stale version is a conflict that changes nothing`() {
        val v = version(oak, staff)
        assertEquals(200, patch(oak, staff, """{"name":"Elm"}""").status)
        val stale = patch(oak, staff, """{"name":"Fir"}""", v)
        assertEquals(409, stale.status, stale.text)
        assertEquals("Elm", obj(call("GET", "/api/v1/gowns/$oak", staff).text)["name"]!!.jsonPrimitive.content)
    }

    @Test fun `tags replace the whole set, move the words, and bump the version even when nothing else changed`() {
        val before = version(oak, staff)
        val r = patch(oak, staff, """{"attributes":${tags("silhouette" to "Mermaid", "fabric" to "Tulle", "neckline" to "Square")}}""")
        assertEquals(200, r.status, r.text)
        val o = obj(r.text)
        assertEquals(before + 1, o["version"]!!.jsonPrimitive.content.toLong())
        val attrs = o["attributes"]!!.jsonArray.associate { it.jsonObject["type"]!!.jsonPrimitive.content to it.jsonObject["values"]!!.jsonArray.map { v -> v.jsonPrimitive.content } }
        assertEquals(mapOf("silhouette" to listOf("Mermaid"), "fabric" to listOf("Tulle"), "neckline" to listOf("Square")), attrs)
        assertTrue(has(oak, "mermaid") && has(oak, "tulle") && has(oak, "oak"))
        assertTrue(!has(oak, "lace") && !has(oak, "line"))
        assertTrue(!has(oak, "square"), "neckline words are not searchable")
        assertEquals(3, jdbc.queryForObject("select count(*) from gown_attribute where gown_id = ?", Int::class.java, oak))
        val none = patch(oak, staff, """{"attributes":[]}""")
        assertEquals(200, none.status)
        assertEquals(0, obj(none.text)["attributes"]!!.jsonArray.size)
        assertEquals(1, terms(oak))
    }

    @Test fun `description clears with blank text, and an unchanged patch is a no-op without audit or version change`() {
        val v = version(oak, staff)
        val same = patch(oak, staff, """{"name":"Oak","description":"A gown","attributes":${tags("silhouette" to "A-line", "fabric" to "Lace")}}""")
        assertEquals(200, same.status, same.text)
        assertEquals(v, obj(same.text)["version"]!!.jsonPrimitive.content.toLong())
        assertEquals(audited, edited().size)
        val cleared = patch(oak, staff, """{"description":"   "}""")
        assertEquals(200, cleared.status)
        assertEquals("null", obj(cleared.text)["description"].toString())
        assertEquals(v + 1, obj(cleared.text)["version"]!!.jsonPrimitive.content.toLong())
    }

    @Test fun `bad input is a 422 naming the field and changes nothing`() {
        val v = version(oak, staff)
        for ((body, field) in listOf(
            """{"name":"   "}""" to "name", """{"name":"${"x".repeat(201)}"}""" to "name",
            """{"description":"${"d".repeat(2001)}"}""" to "description",
            """{"attributes":${tags("fabric" to "Unobtainium")}}""" to "attributes",
        )) {
            val r = patch(oak, staff, body)
            assertEquals(422, r.status, r.text)
            assertTrue(r.text.contains("\"$field\""), r.text)
            assertTrue(!r.text.contains("Unobtainium"), "the rejected value must not be echoed")
        }
        assertEquals(v, version(oak, staff))
    }

    @Test fun `renaming a Taxonomy value rewrites the words of every Gown that uses it and of no other`() {
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        fun put(body: String, ifMatch: Long? = null) =
            c.api("PUT", "/api/v1/taxonomy", body, admin, if (ifMatch == null) emptyMap() else mapOf("If-Match" to ifMatch.toString()))
        val added = put("""{"op":"add","type":"fabric","value":"Crepe"}""")
        assertEquals(200, added.status, added.body)
        val row = Regex(""""id":"([^"]+)","type":"fabric","value":"Crepe","version":(\d+)""").find(added.body)!!.groupValues
        val three = listOf(seed("Ash", "A-line", "Crepe"), seed("Birch", "Mermaid", "Crepe"), seed("Cherry", "Ball gown", "Crepe"))
        val other = oak
        assertTrue(three.all { has(it, "crepe") })
        val renamed = put("""{"op":"rename","id":"${row[1]}","value":"Georgette"}""", row[2].toLong())
        assertEquals(200, renamed.status, renamed.body)
        for (g in three) assertTrue(has(g, "georgette") && !has(g, "crepe"), "Gown $g was not re-indexed")
        assertTrue(has(three[0], "ash") && has(three[0], "line"), "the name and Silhouette words stay")
        assertTrue(has(other, "oak") && has(other, "lace") && !has(other, "georgette"))
        assertEquals(3, jdbc.queryForObject("select count(distinct gown_id) from gown_term where term_bidx = ?", Int::class.java, bidx.of(BidxDomain.GOWN_TERM, "georgette")))
    }
}
