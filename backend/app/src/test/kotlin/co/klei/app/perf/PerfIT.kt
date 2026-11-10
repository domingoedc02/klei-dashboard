package co.klei.app.perf

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.gown.Gown
import co.klei.app.gown.GownAttribute
import co.klei.app.gown.TermIndexer
import co.klei.app.inquiry.Direction
import co.klei.app.inquiry.InquiryService
import co.klei.app.inquiry.Message
import co.klei.app.inquiry.NewInquiry
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.taxonomy.TaxonomyValue
import co.klei.app.upload.FakeStore
import co.klei.app.upload.Images
import co.klei.app.upload.ObjectVault
import co.klei.app.upload.Photo
import co.klei.app.upload.StoredKey
import co.klei.app.upload.StoredObject
import co.klei.app.upload.TagView
import co.klei.app.upload.UploadClient
import co.klei.core.taxonomy.TaxonomyType
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.ColumnRef
import co.klei.crypto.CryptoService
import co.klei.crypto.DayBucket
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfSystemProperty
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
import java.io.File
import java.net.ServerSocket
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Story 9.4: the NFR-2 benchmark. Off unless `-Dklei.perf=true` (driver: infra/ci/perf.sh).
 * The seeder lives here, in test sources, and writes through the same entities and services the app uses, so every column is encrypted.
 * shortcut: Photos of one Gown share two sealed objects (a stored object is at least 64 KB padded, 100k of them would not fit the in-memory store);
 * reads still decrypt a real object per request, only the rows differ. Add per-Photo objects against a real store if S3 latency must be measured.
 */
@Testcontainers
@EnabledIfSystemProperty(named = "klei.perf", matches = "true")
@Import(RecordingMailConfig::class, PerfIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class PerfIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }

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

        private val FIRST = listOf("Aurora", "Beatrix", "Celeste", "Dahlia", "Elodie", "Fleur", "Giselle", "Hazel", "Isolde", "Juliet", "Katya", "Lenore", "Marguerite", "Noelle", "Odette", "Pippa")
        private val SECOND = listOf("Rose", "Moon", "Pearl", "Veil", "Garden", "Silk", "Dawn", "Harbor")
        private val SILHOUETTES = listOf("A-line", "Mermaid", "Ball gown")
        private val FABRICS = listOf("Lace", "Mikado", "Tulle")
    }

    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var bidx: BlindIndex
    @Autowired lateinit var vault: ObjectVault
    @Autowired lateinit var terms: TermIndexer
    @Autowired lateinit var inquiries: InquiryService
    @Autowired lateinit var crypto: CryptoService
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private val gownCount = System.getProperty("klei.perf.gowns", "5000").toInt()
    private val inquiryCount = System.getProperty("klei.perf.inquiries", "5000").toInt()
    private val photosPerGown = System.getProperty("klei.perf.photos", "4").toInt()

    private class Row(val name: String, val budgetMs: Long?, val p95: Long, val median: Long, val max: Long, val n: Int) {
        val ok get() = budgetMs == null || p95 <= budgetMs
    }

    private val rows = mutableListOf<Row>()

    private fun token(email: String, password: String): String {
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return field(c.exchange(c.signIn(email, password)).body, "accessToken")!!
    }

    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    private fun sealedPair(): Pair<StoredKey, StoredKey> = vault.put(Images.jpeg(80, 60)) to vault.put(Images.solid(10, 20, 30))

    private fun storeRows(vararg keys: StoredKey) { for (k in keys) em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, Instant.now())) }

    private fun seedGowns(count: Int, own: Boolean, label: String, tags: Map<String, UUID>): List<UUID> {
        val shared = if (own) null else tx.execute { sealedPair().also { storeRows(it.first, it.second) } }!!
        val made = ArrayList<UUID>(count)
        for (from in 0 until count step 100) tx.execute {
            for (i in from until minOf(count, from + 100)) {
                val gownId = UUID.randomUUID()
                val age = (i % 365).toLong()
                val at = Instant.now().minus(age, ChronoUnit.DAYS)
                val silhouette = SILHOUETTES[i % 3]
                val fabric = FABRICS[(i / 3) % 3]
                val name = "${FIRST[i % FIRST.size]} ${SECOND[(i / FIRST.size) % SECOND.size]} $label$i"
                em.persist(Gown(gownId, name, "A $fabric $silhouette gown number $i", 90, at, age == 0L, null, bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(at)), bidx.of(BidxDomain.IDEM, "save|$gownId")))
                em.flush()
                em.persist(GownAttribute(UUID.randomUUID(), gownId, tags.getValue(silhouette)))
                em.persist(GownAttribute(UUID.randomUUID(), gownId, tags.getValue(fabric)))
                terms.index(gownId, name, listOf(TagView(TaxonomyType.SILHOUETTE.code, silhouette), TagView(TaxonomyType.FABRIC.code, fabric)))
                repeat(photosPerGown) { p ->
                    val pair = shared ?: sealedPair().also { storeRows(it.first, it.second) }
                    val pid = UUID.randomUUID()
                    val photo = Photo(pid, null, pair.first.id, pair.second.id, bidx.of(BidxDomain.IDEM, pid.toString()), "p$p.jpg", "image/jpeg", 1L, at.plusSeconds(p.toLong()))
                    photo.gownId = gownId
                    em.persist(photo)
                }
                made += gownId
            }
            em.flush()
            em.clear()
        }
        return made
    }

    private fun seedInquiries(count: Int, adminId: UUID): UUID {
        var heavy: UUID? = null
        for (i in 0 until count) {
            val made = inquiries.create(
                NewInquiry("Client ${FIRST[i % FIRST.size]} ${i % 700}", "perf${i % 2000}@example.test", "Veil fitting question ${SECOND[i % SECOND.size]} $i", "Hello, I would like to ask about a fitting for my wedding in June. Message number $i."),
                adminId, null,
            )
            if (i == count / 2) heavy = made.item.id
        }
        val id = heavy!!
        tx.execute {
            for (m in 1..40) {
                em.persist(Message(UUID.randomUUID(), id, null, Direction.IN, "Follow up $m. " + "Words in a longer message. ".repeat(20), null, Instant.now().plusSeconds(m.toLong())))
            }
        }
        return id
    }

    /** Three warm-up calls, then [n] timed ones; [call] asserts its own status. */
    private fun measure(name: String, budgetMs: Long?, n: Int = 30, call: () -> Unit) {
        repeat(3) { call() }
        val t = LongArray(n) { val s = System.nanoTime(); call(); (System.nanoTime() - s) / 1_000_000 }.sorted()
        rows += Row(name, budgetMs, t[((n * 95 + 99) / 100) - 1], t[n / 2], t.last(), n)
    }

    private fun once(name: String, budgetMs: Long?, call: () -> Unit) {
        val s = System.nanoTime(); call(); val ms = (System.nanoTime() - s) / 1_000_000
        rows += Row(name, budgetMs, ms, ms, ms, 1)
    }

    /** [min] guards against a benchmark that is fast because it returns nothing. */
    private fun post(path: String, token: String, body: String, min: Int = 0, status: Int = 200): String {
        val r = UploadClient.call("POST", "$api$path", token, body.toByteArray(), mapOf("Content-Type" to "application/json"))
        assertEquals(status, r.status, "$path: ${r.text.take(300)}")
        if (min > 0) assertTrue(obj(r.text)["items"]!!.jsonArray.size >= min, "$path returned fewer than $min items: ${r.text.take(200)}")
        return r.text
    }

    private fun get(path: String, token: String): String {
        val r = UploadClient.call("GET", "$api$path", token)
        assertEquals(200, r.status, "$path: ${r.text.take(300)}")
        return r.text
    }

    @Test fun `NFR-2 p95 targets hold with the seeded workspace`() {
        val taxonomy = tx.execute { em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.associate { it.value to it.id } }!!
        val adminId = jdbc.queryForObject("select id from app_user limit 1", UUID::class.java)!!

        val t0 = System.nanoTime()
        seedGowns(gownCount, own = false, label = "", tags = taxonomy)
        val deleteSet = seedGowns(100, own = true, label = "del", tags = taxonomy)
        val thread = seedInquiries(inquiryCount, adminId)
        val seedSeconds = (System.nanoTime() - t0) / 1_000_000_000
        assertEquals(gownCount + 100L, jdbc.queryForObject("select count(*) from gown", Long::class.java))

        val admin = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
        val sample = jdbc.queryForObject("select id from gown order by seq desc offset 7 limit 1", UUID::class.java)!!
        val photo = jdbc.queryForObject("select id from photo where gown_id = ? limit 1", UUID::class.java, sample)!!

        measure("Gallery page of 48", 1500) { post("/api/v1/gowns/query", admin, """{"limit":48}""", min = 48) }
        val first = obj(UploadClient.call("POST", "$api/api/v1/gowns/query", admin, """{"limit":48}""".toByteArray(), mapOf("Content-Type" to "application/json")).text)
        val next = first["next"]!!.jsonPrimitive.content
        measure("Gallery page 2 (cursor)", 1500) { post("/api/v1/gowns/query", admin, """{"limit":48,"before":$next}""", min = 48) }
        val view = Json.parseToJsonElement(get("/api/v1/taxonomy", admin)).jsonObject["groups"]!!.jsonArray.flatMap { it.jsonObject["values"]!!.jsonArray }.map { it.jsonObject }
        val silhouette = view.first { it["value"]!!.jsonPrimitive.content == "A-line" }["id"]!!.jsonPrimitive.content
        val fabric = view.first { it["value"]!!.jsonPrimitive.content == "Lace" }["id"]!!.jsonPrimitive.content
        measure("Gallery filter change (Silhouette)", 1000) { post("/api/v1/gowns/query", admin, """{"limit":48,"silhouette":["$silhouette"]}""", min = 48) }
        measure("Gallery filter change (Silhouette, Fabric, 30 days)", 1000) { post("/api/v1/gowns/query", admin, """{"limit":48,"silhouette":["$silhouette"],"fabric":["$fabric"],"days":30}""", min = 1) }
        measure("Global search (Fabric word)", 1000) { post("/api/v1/search", admin, """{"q":"lace"}""", min = 6) }
        measure("Global search (name and subject words)", 1000) { post("/api/v1/search", admin, """{"q":"aurora veil"}""", min = 1) }
        measure("Inquiry list page (25)", 1000) { post("/api/v1/inquiries/query", admin, """{"limit":25}""", min = 25) }
        measure("Inquiry list, status New", 1000) { post("/api/v1/inquiries/query", admin, """{"limit":25,"status":"new"}""", min = 25) }
        measure("Open thread (41 Messages)", 1000) {
            val m = obj(get("/api/v1/inquiries/$thread", admin))["messages"]!!.jsonArray.size
            assertEquals(41, m)
        }
        measure("Open viewer, first photo", 1500) {
            get("/api/v1/gowns/$sample", admin)
            val r = UploadClient.call("GET", "$api/api/v1/gowns/$sample/photos/$photo?size=full", admin)
            assertEquals(200, r.status)
        }
        measure("Dashboard", 1500) { get("/api/v1/dashboard", admin) }
        measure("Inbox badge count", 1000) { get("/api/v1/inquiries/count", admin) }
        measure("Bell list", 1000) { get("/api/v1/notifications", admin) }

        // Crypto overhead per page: 48 cards of 8 encrypted columns each, decrypted one by one as the read side does.
        val col = ColumnRef("perf", "c")
        val rowId = UUID.randomUUID()
        val blob = crypto.encrypt("A gown description of average length".toByteArray(), col, rowId)
        measure("Crypto per Gallery page (384 decrypts)", 200) { repeat(48 * 8) { crypto.decrypt(blob, col, rowId) } }

        // Not NFR-2 rows: no target in the PRD, so the budget is this test's own guard (OPEN QUESTION whether it should be lower).
        val tax = Json.parseToJsonElement(get("/api/v1/taxonomy", admin)).jsonObject["groups"]!!.jsonArray.flatMap { it.jsonObject["values"]!!.jsonArray }.map { it.jsonObject }.first { it["value"]!!.jsonPrimitive.content == "Tulle" }
        once("Taxonomy rename of a Fabric used by about a third of ${gownCount + 100} Gowns", 5000) {
            val r = UploadClient.call("PUT", "$api/api/v1/taxonomy", admin, """{"op":"rename","id":"${tax["id"]!!.jsonPrimitive.content}","value":"Tulle Soft"}""".toByteArray(),
                mapOf("Content-Type" to "application/json", "If-Match" to tax["version"]!!.jsonPrimitive.content))
            assertEquals(200, r.status, r.text.take(300))
        }
        once("Delete 100 Gowns", 5000) { post("/api/v1/gowns/delete", admin, """{"ids":[${deleteSet.joinToString(",") { "\"$it\"" }}]}""") }
        assertEquals(gownCount.toLong(), jdbc.queryForObject("select count(*) from gown", Long::class.java))

        val report = buildString {
            appendLine("workspace: $gownCount Gowns x $photosPerGown Photos, $inquiryCount Inquiries, seeded in ${seedSeconds}s")
            appendLine("%-62s %8s %8s %8s %8s  %s".format("check", "p95 ms", "median", "max", "budget", "result"))
            for (r in rows) appendLine("%-62s %8d %8d %8d %8s  %s".format(r.name.take(62), r.p95, r.median, r.max, r.budgetMs?.toString() ?: "-", if (r.ok) "ok" else "MISS"))
        }
        println(report)
        File("target").apply { mkdirs() }.resolve("perf-report.txt").writeText(report)
        val missed = rows.filterNot { it.ok }
        assertTrue(missed.isEmpty(), "p95 over budget: " + missed.joinToString { "${it.name} ${it.p95} ms > ${it.budgetMs} ms" })
    }
}
