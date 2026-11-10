package co.klei.app.upload

import co.klei.app.TestSupport
import co.klei.app.ai.AiUsage
import co.klei.app.ai.OpenAiCompatibleAdapter
import co.klei.app.ai.StubProvider
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import co.klei.app.gown.Gown
import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.core.ai.AiCall
import co.klei.core.ai.AiOutcome
import co.klei.core.ai.AiProviderPort
import co.klei.core.ai.AiPurpose
import co.klei.core.ai.DescribeImage
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.notification.NotificationPort
import co.klei.core.notification.NotificationType
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.DayBucket
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.AfterAll
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
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.fail

class RecordingNotes : NotificationPort {
    data class Sent(val type: NotificationType, val recipients: List<UUID>, val title: String, val target: String?)

    val sent = CopyOnWriteArrayList<Sent>()
    override fun notify(type: NotificationType, recipients: List<UUID>, title: String, target: String?) {
        sent += Sent(type, recipients, title, target)
    }
}

/** The real adapter behind a recorder: whether each verify call ran inside a transaction, and a hook that runs just before it. */
class VerifySpy(private val real: OpenAiCompatibleAdapter) : AiProviderPort by real {
    val inTransaction = CopyOnWriteArrayList<Boolean>()
    @Volatile var before: (() -> Unit)? = null

    fun delegate(): OpenAiCompatibleAdapter = real

    override fun compare(call: AiCall, images: List<DescribeImage>): List<List<Int>> {
        inTransaction += TransactionSynchronizationManager.isActualTransactionActive()
        before?.invoke()
        return real.compare(call, images)
    }
}

/** Story 4.3: start, progress, clustering by colour through a loopback provider, Retry, locks, recovery, cascade. */
@Testcontainers
@Import(RecordingMailConfig::class, GroupingIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class GroupingIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
        @Bean @Primary fun notes() = RecordingNotes()
        @Bean @Primary fun spy(real: OpenAiCompatibleAdapter) = VerifySpy(real)
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private val stub = StubProvider()
        @Volatile private var configured = false

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

        @AfterAll @JvmStatic fun stopStub() = stub.close()

        val RED = Triple(200, 20, 20)
        val RED2 = Triple(190, 26, 24)
        val GREEN = Triple(20, 200, 20)
        val GREEN2 = Triple(26, 190, 24)
        val BLUE = Triple(20, 20, 200)
        val BLUE2 = Triple(24, 26, 190)
    }

    @Autowired lateinit var ctx: ServletWebServerApplicationContext
    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var jdbc: JdbcTemplate
    @Autowired lateinit var notes: RecordingNotes
    @Autowired lateinit var spy: VerifySpy
    @Autowired lateinit var grouping: GroupingService
    @Autowired lateinit var batches: UploadBatchService
    @Autowired lateinit var store: FakeStore
    @Autowired lateinit var bidx: BlindIndex
    @Autowired lateinit var audit: AuditService
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun client() = AuthWebClient("http://127.0.0.1:$authPort", api)
    private fun token(email: String, pw: String): String {
        val c = client()
        return field(c.exchange(c.signIn(email, pw)).body, "accessToken")!!
    }

    class Person(val id: UUID, val token: String)

    private fun person(role: String = DefaultRoles.STAFF): Person {
        val email = "gr-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == role }.id
        val id = tx.execute { users.create("Gia Group", email, "Stafer-pass-1", rid, UserStatus.ACTIVE, true).id }!!
        return Person(id, token(email, "Stafer-pass-1"))
    }

    private fun open(p: Person) = UploadClient.call("POST", "$api/api/v1/uploads", p.token).also { assertEquals(200, it.status, it.text) }.id()
    private fun add(p: Person, batch: String, c: Triple<Int, Int, Int>, name: String = "gown.jpg") =
        UploadClient.photo(api, p.token, batch, name, Images.solid(c.first, c.second, c.third), UUID.randomUUID().toString()).also { assertEquals(201, it.status, it.text) }.id()
    private fun start(p: Person, batch: String) = UploadClient.call("POST", "$api/api/v1/uploads/$batch/start", p.token)
    private fun status(p: Person, batch: String) = UploadClient.call("GET", "$api/api/v1/uploads/$batch", p.token)
    private fun embeds() = stub.seen.count { it.substringBefore(" | ").endsWith("/embeddings") }
    private fun chatBodies() = stub.seen.filter { it.substringBefore(" | ").endsWith("/chat/completions") }.map { it.substringAfterLast(" | ") }
    private fun chats() = chatBodies().count { !it.contains(StubProvider.VERIFY_MARK) }
    private fun verifies() = chatBodies().count { it.contains(StubProvider.VERIFY_MARK) }
    private fun usageRows() = jdbc.queryForObject("select count(*) from ai_usage", Int::class.java)!!
    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text).jsonObject

    private fun until(p: Person, batch: String, vararg phases: String): JsonObject {
        val end = System.nanoTime() + 40_000_000_000L
        while (System.nanoTime() < end) {
            val r = status(p, batch)
            assertEquals(200, r.status, r.text)
            val o = obj(r.text)
            if (o["phase"]!!.jsonPrimitive.content in phases) return o
            Thread.sleep(100)
        }
        fail("batch never reached $phases")
    }

    private fun groups(o: JsonObject) = o["groups"]!!.jsonArray.map { it.jsonObject }
    private fun photoIds(g: JsonObject) = g["photoIds"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet()

    @BeforeEach
    fun reset() {
        stub.mode = StubProvider.Mode.OK
        stub.vectorOf = StubProvider.MeanColour
        stub.embedsLeft.set(Int.MAX_VALUE)
        stub.delayMs = 0
        stub.chatsLeft.set(Int.MAX_VALUE)
        stub.chatAnswer = StubProvider.DEFAULT_ANSWER
        stub.verifyAnswer = StubProvider.ONE_GOWN
        stub.verifiesLeft.set(Int.MAX_VALUE)
        spy.before = null
        spy.inTransaction.clear()
        notes.sent.clear()
        synchronized(GroupingIT::class.java) {
            if (configured) return
            val body = """{"preset":"litellm","baseUrl":"${stub.baseUrl}","apiKey":"sk-grouping-key-0123456789","organization":"org-x","chatModel":"chat-x","visionModel":"vision-x","embeddingModel":"dinov2-base","temperature":0.7,"maxTokens":1024}"""
            val t = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
            assertEquals(200, client().api("PUT", "/api/v1/admin/ai", body, t, mapOf("If-Match" to "0")).status)
            configured = true
        }
    }

    @Test
    fun `start and status need the upload permission, an owned batch and at least one photo`() {
        val p = person()
        val batch = open(p)
        assertEquals(401, UploadClient.call("POST", "$api/api/v1/uploads/$batch/start", null).status)
        assertEquals(401, UploadClient.call("GET", "$api/api/v1/uploads/$batch", null).status)
        val viewer = person(DefaultRoles.VIEWER)
        assertEquals(403, start(viewer, batch).status)
        assertEquals(403, status(viewer, batch).status)
        val other = person()
        assertEquals(404, start(other, batch).status)
        assertEquals(404, status(other, batch).status)
        val empty = start(p, batch)
        assertEquals(422, empty.status, empty.text)
        assertTrue(empty.text.contains("photos") && empty.text.contains("required"), empty.text)
        assertTrue(status(p, batch).text.contains(""""phase":"empty""""))
    }

    @Test
    fun `three gowns of two photos become three groups, every photo grouped, usage and Notification written`() {
        val p = person()
        val batch = open(p)
        val ids = listOf(RED, RED2, GREEN, GREEN2, BLUE, BLUE2).map { add(p, batch, it, "bride-name-gq01.jpg") }
        val rows = usageRows()
        val calls = embeds()
        val r = start(p, batch)
        assertEquals(202, r.status, r.text)
        assertTrue(r.text.contains(""""phase":"processing""""), r.text)
        val done = until(p, batch, "review", "error")
        assertEquals("review", done["phase"]!!.jsonPrimitive.content, done.toString())
        val gs = groups(done)
        assertEquals(3, gs.size)
        assertEquals(setOf("Rose Lace"), gs.map { it["name"]!!.jsonPrimitive.content }.toSet())
        assertEquals(setOf(setOf(ids[0], ids[1]), setOf(ids[2], ids[3]), setOf(ids[4], ids[5])), gs.map(::photoIds).toSet())
        gs.forEach {
            assertTrue(it["confidence"]!!.jsonPrimitive.int >= 90, it.toString())
            assertEquals("high", it["band"]!!.jsonPrimitive.content)
        }
        assertEquals(0, jdbc.queryForObject("select count(*) from photo where batch_id = ?::uuid and group_id is null", Int::class.java, batch))
        assertEquals(6, jdbc.queryForObject("select count(*) from embedding e join photo p on p.id = e.photo_id where p.batch_id = ?::uuid", Int::class.java, batch))
        assertEquals(6, embeds() - calls)
        assertEquals(12, usageRows() - rows, "six embeddings, three verifications and three descriptions")
        val prompts = tx.execute { em.createQuery("select u from AiUsage u", AiUsage::class.java).resultList.mapNotNull { it.prompt } }!!
        assertTrue(prompts.containsAll(ids.map { "image $it" }), prompts.toString())
        assertFalse(prompts.any { it.contains("gq01") }, "filename reached the usage log")
        val sent = notes.sent.single()
        assertEquals(NotificationType.AI_FINISHED, sent.type)
        assertEquals(listOf(p.id), sent.recipients)
        assertEquals("AI finished grouping 6 images into 3 gowns", sent.title)
    }

    private fun verifyUsage(p: Person) = tx.execute { em.createQuery("select u from AiUsage u", AiUsage::class.java).resultList.filter { it.purpose == AiPurpose.VERIFY && it.userId == p.id }.map { it.outcome } }!!

    @Test
    fun `a group the model splits becomes two groups, each verified once and outside any transaction`() {
        val p = person()
        val batch = open(p)
        stub.vectorOf = { floatArrayOf(0.25f, 0.5f, 0.75f) } // every photo alike, so the clusterer makes one group of four
        val ids = (1..4).map { add(p, batch, RED) }
        stub.verifyAnswer = { """{"groups":[[1,3],[2,4]]}""" }
        val before = verifies()
        start(p, batch)
        val done = until(p, batch, "review", "error")
        assertEquals("review", done["phase"]!!.jsonPrimitive.content, done.toString())
        assertEquals(setOf(setOf(ids[0], ids[2]), setOf(ids[1], ids[3])), groups(done).map(::photoIds).toSet())
        assertEquals(1, verifies() - before)
        assertTrue(spy.inTransaction.isNotEmpty() && spy.inTransaction.none { it }, "a verify call ran inside a transaction")
        assertEquals(listOf(AiOutcome.OK), verifyUsage(p))
        val body = chatBodies().last { it.contains(StubProvider.VERIFY_MARK) }
        assertTrue(body.contains("vision-x") && body.contains("Photo 4 of 4") && !body.contains(batch) && !ids.any { body.contains(it) }, "name or id reached the provider")
    }

    @Test
    fun `a lone photo is not verified, and a part the model leaves alone reads Low`() {
        val p = person()
        val batch = open(p)
        stub.vectorOf = { floatArrayOf(0.25f, 0.5f, 0.75f) }
        val ids = (1..3).map { add(p, batch, RED) }
        stub.verifyAnswer = { """{"groups":[[1,2],[3]]}""" }
        start(p, batch)
        val gs = groups(until(p, batch, "review", "error"))
        assertEquals(2, gs.size)
        assertEquals(setOf(ids[2]), photoIds(gs[0]))
        assertEquals("low", gs[0]["band"]!!.jsonPrimitive.content)
        assertEquals(setOf(ids[0], ids[1]), photoIds(gs[1]))
    }

    @Test
    fun `a failed verify keeps the group whole, unverified and below High even after describe`() {
        val p = person()
        val batch = open(p)
        val pair = listOf(RED, RED2).map { add(p, batch, it) }.toSet()
        add(p, batch, GREEN)
        stub.verifiesLeft.set(0)
        start(p, batch)
        val done = until(p, batch, "review", "error")
        assertEquals("review", done["phase"]!!.jsonPrimitive.content, done.toString())
        val g = groups(done).first { photoIds(it) == pair }
        assertEquals(89, g["confidence"]!!.jsonPrimitive.int, g.toString())
        assertEquals("medium", g["band"]!!.jsonPrimitive.content)
        assertEquals(listOf(AiOutcome.ERROR), verifyUsage(p), "one usage row for the failed pair, none for the lone photo")
        assertFalse(done.toString().contains("PROVIDER-SECRET"), "provider text echoed")
        assertEquals(1, notes.sent.size)
    }

    @Test
    fun `a malformed verify answer is the same as a failed one`() {
        val p = person()
        val batch = open(p)
        val pair = listOf(RED, RED2).map { add(p, batch, it) }.toSet()
        stub.verifyAnswer = { """{"groups":[[1,1]]}""" }
        start(p, batch)
        val g = groups(until(p, batch, "review", "error")).single()
        assertEquals(pair, photoIds(g))
        assertEquals(89, g["confidence"]!!.jsonPrimitive.int)
    }

    @Test
    fun `a group of nine sends eight thumbnails and every photo still lands in a group`() {
        val p = person()
        val batch = open(p)
        stub.vectorOf = { floatArrayOf(0.25f, 0.5f, 0.75f) }
        val ids = (1..9).map { add(p, batch, RED) }.toSet()
        stub.verifyAnswer = { """{"groups":[[1,2,3,4],[5,6,7,8]]}""" }
        start(p, batch)
        val gs = groups(until(p, batch, "review", "error"))
        assertEquals(2, gs.size)
        assertEquals(ids, gs.flatMap { photoIds(it) }.toSet())
        assertEquals(9, gs.sumOf { photoIds(it).size })
        val body = chatBodies().last { it.contains(StubProvider.VERIFY_MARK) }
        assertEquals(8, Regex(""""type":"image_url"""").findAll(body).count())
        assertTrue(body.contains("Photo 8 of 8") && !body.contains("Photo 9"), body.take(300))
    }

    @Test
    fun `a batch discarded while verify is in flight leaves no group and does not fail anything`() {
        val p = person()
        val batch = open(p)
        listOf(RED, RED2).forEach { add(p, batch, it) }
        spy.before = { batches.discard(p.id) }
        start(p, batch)
        val end = System.nanoTime() + 20_000_000_000L
        while (spy.inTransaction.isEmpty() && System.nanoTime() < end) Thread.sleep(50)
        while (Thread.getAllStackTraces().keys.any { it.name == "grouping" && it.state == Thread.State.RUNNABLE } && System.nanoTime() < end) Thread.sleep(50)
        Thread.sleep(300)
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_batch where id = ?::uuid", Int::class.java, batch))
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_group where batch_id = ?::uuid", Int::class.java, batch))
        assertEquals(0, jdbc.queryForObject("select count(*) from photo where batch_id = ?::uuid", Int::class.java, batch))
        assertEquals(0, notes.sent.size)
    }

    @Test
    fun `the adapter refuses a verify call made inside a transaction and leaves no usage row`() {
        val real = spy.delegate()
        val rows = usageRows()
        tx.execute { assertFailsWith<IllegalStateException> { real.compare(AiCall(AiPurpose.VERIFY, null), listOf(DescribeImage(Images.solid(1, 2, 3), "image/jpeg"))) } }
        assertEquals(rows, usageRows())
    }

    @Test
    fun `a lone photo is a Low group and the review lists Low confidence first`() {
        val p = person()
        val batch = open(p)
        val pair = listOf(RED, RED2).map { add(p, batch, it) }.toSet()
        val lone = add(p, batch, GREEN)
        start(p, batch)
        val gs = groups(until(p, batch, "review", "error"))
        assertEquals(2, gs.size)
        assertEquals(setOf(lone), photoIds(gs[0]))
        assertEquals("low", gs[0]["band"]!!.jsonPrimitive.content)
        assertEquals(pair, photoIds(gs[1]))
    }

    @Test
    fun `start while processing is a no-op and the batch is locked against adding or deleting photos`() {
        val p = person()
        val batch = open(p)
        val a = add(p, batch, RED)
        add(p, batch, GREEN)
        stub.delayMs = 400
        val calls = embeds()
        assertEquals(202, start(p, batch).status)
        val again = start(p, batch)
        assertEquals(202, again.status, again.text)
        assertTrue(again.text.contains(""""phase":"processing""""), again.text)
        assertTrue(again.text.contains(""""total":2"""), again.text)
        assertEquals(409, UploadClient.photo(api, p.token, batch, "x.jpg", Images.solid(1, 2, 3), UUID.randomUUID().toString()).status)
        assertEquals(409, UploadClient.call("DELETE", "$api/api/v1/uploads/$batch/photos/$a", p.token).status)
        until(p, batch, "review", "error")
        assertEquals(2, embeds() - calls, "a second start must not embed again")
        assertEquals(409, start(p, batch).status, "a finished batch is not started again")
    }

    @Test
    fun `a failing step stops with a fixed code, and Retry embeds only the photos without a vector`() {
        val p = person()
        val batch = open(p)
        listOf(RED, RED2, GREEN, GREEN2).forEach { add(p, batch, it) }
        stub.embedsLeft.set(2)
        val calls = embeds()
        start(p, batch)
        val failed = until(p, batch, "review", "error")
        assertEquals("error", failed["phase"]!!.jsonPrimitive.content, failed.toString())
        val e = failed["error"]!!.jsonObject
        assertEquals("unauthorized", e["code"]!!.jsonPrimitive.content)
        assertEquals(1, e["step"]!!.jsonPrimitive.int)
        assertTrue(e["lastGood"] != null && e["lastGood"].toString() != "null", e.toString())
        assertFalse(failed.toString().contains("sk-grouping"), "key echoed")
        assertEquals(3, embeds() - calls)
        stub.embedsLeft.set(Int.MAX_VALUE)
        assertEquals(202, start(p, batch).status)
        val ok = until(p, batch, "review", "error")
        assertEquals("review", ok["phase"]!!.jsonPrimitive.content, ok.toString())
        assertEquals(5, embeds() - calls, "Retry re-embedded photos that already had a vector")
        assertEquals(2, groups(ok).size)
        assertEquals(1, notes.sent.size)
    }

    @Test
    fun `a batch left processing by a restart becomes an interrupted error that Retry resumes`() {
        val p = person()
        val batch = open(p)
        add(p, batch, RED)
        add(p, batch, RED2)
        tx.executeWithoutResult { em.find(UploadBatch::class.java, UUID.fromString(batch))!!.phase = BatchPhase.PROCESSING }
        grouping.markInterrupted()
        val o = obj(status(p, batch).text)
        assertEquals("error", o["phase"]!!.jsonPrimitive.content)
        assertEquals("interrupted", o["error"]!!.jsonObject["code"]!!.jsonPrimitive.content)
        assertEquals(202, start(p, batch).status)
        assertEquals(1, groups(until(p, batch, "review", "error")).size)
    }

    private fun described(batch: String): List<UploadGroup> =
        tx.execute { em.createQuery("select g from UploadGroup g where g.batchId = :b", UploadGroup::class.java).setParameter("b", UUID.fromString(batch)).resultList.onEach { it.attributes; it.description } }!!

    @Test
    fun `each group is named, tagged from the Taxonomy only and described from at most four thumbnails`() {
        val p = person()
        val batch = open(p)
        repeat(5) { add(p, batch, RED, "bride-name-gq02.jpg") }
        add(p, batch, GREEN)
        stub.chatAnswer = { """{"name":"${"N".repeat(120)}","attributes":{"Silhouette":["a-line","Trumpet"],"fabric":["Satin","LACE"],"color":["Ivory"]},"description":"A soft lace gown."}""" }
        val before = chats()
        start(p, batch)
        val done = until(p, batch, "review", "error")
        assertEquals("review", done["phase"]!!.jsonPrimitive.content, done.toString())
        assertEquals(2, chats() - before)
        val gs = described(batch)
        assertEquals(2, gs.size)
        gs.forEach {
            assertEquals(80, it.name.length)
            assertEquals(listOf("silhouette:A-line", "fabric:Lace"), it.attributes.items.map { t -> "${t.type}:${t.value}" })
            assertEquals("A soft lace gown.", it.description)
        }
        val bodies = chatBodies().filter { !it.contains(StubProvider.VERIFY_MARK) }.takeLast(2)
        assertEquals(setOf(4, 1), bodies.map { Regex("data:image/").findAll(it).count() }.toSet())
        bodies.forEach {
            assertTrue(it.contains("vision-x") && it.contains("Photo 1 of "), it.take(300))
            assertFalse(it.contains("gq02") || it.contains(batch), "a name or id reached the provider")
        }
        assertEquals(1, notes.sent.size, "one Notification after the last group")
    }

    @Test
    fun `a failing group stops the batch at step 3 and Retry describes only the groups still missing`() {
        val p = person()
        val batch = open(p)
        listOf(RED, RED2, GREEN, GREEN2, BLUE, BLUE2).forEach { add(p, batch, it) }
        stub.chatsLeft.set(1)
        val before = chats()
        start(p, batch)
        val failed = until(p, batch, "review", "error")
        assertEquals("error", failed["phase"]!!.jsonPrimitive.content, failed.toString())
        val e = failed["error"]!!.jsonObject
        assertEquals("http_error", e["code"]!!.jsonPrimitive.content)
        assertEquals(3, e["step"]!!.jsonPrimitive.int)
        assertFalse(failed.toString().contains("PROVIDER-SECRET"), "provider text echoed")
        assertEquals(0, notes.sent.size)
        val kept = described(batch).count { it.description != null }
        assertEquals(1, kept)
        stub.chatsLeft.set(Int.MAX_VALUE)
        val mid = chats()
        assertEquals(202, start(p, batch).status)
        assertEquals("review", until(p, batch, "review", "error")["phase"]!!.jsonPrimitive.content)
        assertEquals(2, chats() - mid, "Retry called the provider for a group that was already described")
        assertEquals(3, described(batch).count { it.description != null })
        assertEquals(1, notes.sent.size)
        assertTrue(chats() - before >= 4)
    }

    private fun patch(p: Person, batch: String, group: String, body: String, version: Any? = null) =
        UploadClient.call(
            "PATCH", "$api/api/v1/uploads/$batch/groups/$group", p.token, body.toByteArray(),
            buildMap { put("Content-Type", "application/json"); if (version != null) put("If-Match", version.toString()) },
        )

    @Test
    fun `a Staff member edits name, tags and description, stale versions and unknown tags are refused`() {
        val p = person()
        val batch = open(p)
        listOf(RED, RED2, GREEN).forEach { add(p, batch, it) }
        start(p, batch)
        val g = groups(until(p, batch, "review", "error")).first { photoIds(it).size == 2 }
        val gid = g["id"]!!.jsonPrimitive.content
        val v = g["version"]!!.jsonPrimitive.content
        assertEquals(listOf("A-line", "Lace"), g["tags"]!!.jsonArray.map { it.jsonObject["value"]!!.jsonPrimitive.content })
        assertEquals("A soft lace gown.", g["description"]!!.jsonPrimitive.content)

        val ok = patch(p, batch, gid, """{"name":"  Ivy Satin ","attributes":[{"type":"fabric","value":"Mikado"},{"type":"silhouette","value":"Ball gown"}],"description":"Hand-finished."}""", v)
        assertEquals(200, ok.status, ok.text)
        val saved = obj(ok.text)
        assertEquals("Ivy Satin", saved["name"]!!.jsonPrimitive.content)
        assertEquals(setOf("fabric:Mikado", "silhouette:Ball gown"), saved["tags"]!!.jsonArray.map { "${it.jsonObject["type"]!!.jsonPrimitive.content}:${it.jsonObject["value"]!!.jsonPrimitive.content}" }.toSet())
        assertTrue(saved["version"]!!.jsonPrimitive.content != v, "version did not move")
        assertEquals(photoIds(g), photoIds(saved))
        val back = groups(obj(status(p, batch).text)).first { it["id"]!!.jsonPrimitive.content == gid }
        assertEquals("Hand-finished.", back["description"]!!.jsonPrimitive.content)
        assertEquals(g["confidence"], back["confidence"], "an edit must not change the AI confidence")

        assertEquals(409, patch(p, batch, gid, """{"name":"Late"}""", v).status, "stale version")
        assertEquals(400, patch(p, batch, gid, """{"name":"No header"}""").status)
        val now = saved["version"]!!.jsonPrimitive.content
        assertEquals(422, patch(p, batch, gid, """{"name":"   "}""", now).status)
        assertEquals(422, patch(p, batch, gid, """{"name":"${"N".repeat(81)}"}""", now).status)
        assertEquals(422, patch(p, batch, gid, """{"description":"${"d".repeat(2001)}"}""", now).status)
        val unknown = patch(p, batch, gid, """{"attributes":[{"type":"fabric","value":"Moonlight"}]}""", now)
        assertEquals(422, unknown.status, unknown.text)
        assertEquals(422, patch(p, batch, gid, """{"attributes":[{"type":"colour","value":"Ivory"}]}""", now).status)
        val cleared = patch(p, batch, gid, """{"attributes":[]}""", now)
        assertEquals(200, cleared.status, cleared.text)
        assertEquals(0, obj(cleared.text)["tags"]!!.jsonArray.size)
        assertEquals("Ivy Satin", obj(cleared.text)["name"]!!.jsonPrimitive.content, "a field left out must stay")
    }

    @Test
    fun `group edits need the upload permission, an owned batch and the review phase`() {
        val p = person()
        val batch = open(p)
        add(p, batch, RED)
        val early = UUID.randomUUID().toString()
        assertEquals(404, patch(p, batch, early, """{"name":"x"}""", 0).status)
        start(p, batch)
        val g = groups(until(p, batch, "review", "error")).single()
        val gid = g["id"]!!.jsonPrimitive.content
        val v = g["version"]!!.jsonPrimitive.content
        assertEquals(401, UploadClient.call("PATCH", "$api/api/v1/uploads/$batch/groups/$gid", null, "{}".toByteArray()).status)
        assertEquals(403, patch(person(DefaultRoles.VIEWER), batch, gid, """{"name":"x"}""", v).status)
        assertEquals(404, patch(person(), batch, gid, """{"name":"x"}""", v).status)
        tx.executeWithoutResult { em.find(UploadBatch::class.java, UUID.fromString(batch))!!.phase = BatchPhase.PROCESSING }
        assertEquals(409, patch(p, batch, gid, """{"name":"x"}""", v).status, "a batch being grouped is locked")
    }

    @Test
    fun `discarding the batch removes its embeddings and groups`() {
        val p = person()
        val batch = open(p)
        listOf(RED, GREEN).forEach { add(p, batch, it) }
        start(p, batch)
        until(p, batch, "review", "error")
        val sql = "select count(*) from embedding e join photo p on p.id = e.photo_id where p.batch_id = ?::uuid"
        assertEquals(2, jdbc.queryForObject(sql, Int::class.java, batch))
        assertEquals(2, jdbc.queryForObject("select count(*) from upload_group where batch_id = ?::uuid", Int::class.java, batch))
        batches.discard(p.id)
        assertEquals(0, jdbc.queryForObject(sql, Int::class.java, batch))
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_group where batch_id = ?::uuid", Int::class.java, batch))
    }

    private fun post(p: Person?, batch: String, path: String, body: String = "{}", version: Any? = null) =
        UploadClient.call(
            "POST", "$api/api/v1/uploads/$batch/$path", p?.token, body.toByteArray(),
            buildMap { put("Content-Type", "application/json"); if (version != null) put("If-Match", version.toString()) },
        )

    private fun gid(g: JsonObject) = g["id"]!!.jsonPrimitive.content
    private fun ver(g: JsonObject) = g["version"]!!.jsonPrimitive.content
    private fun ids(g: JsonObject) = g["photoIds"]!!.jsonArray.map { it.jsonPrimitive.content }

    /** RED and RED2 group together, GREEN is alone; returns the batch and its groups. */
    private fun twoGroups(p: Person): Pair<String, List<JsonObject>> {
        val batch = open(p)
        listOf(RED, RED2, GREEN).forEach { add(p, batch, it) }
        start(p, batch)
        return batch to groups(until(p, batch, "review", "error"))
    }

    @Test
    fun `moving a photo to another group or a new one removes a group left empty`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val pair = gs.first { ids(it).size == 2 }
        val lone = gs.first { ids(it).size == 1 }
        val toNew = post(p, batch, "photos/${ids(pair)[0]}/move", """{"groupId":null}""", ver(pair))
        assertEquals(200, toNew.status, toNew.text)
        val after = obj(toNew.text)
        assertEquals(3, groups(after).size)
        val made = groups(after).first { it["name"]!!.jsonPrimitive.content == "New group" }
        assertEquals(gid(made), after["focus"]!!.jsonPrimitive.content)
        assertEquals("low", made["band"]!!.jsonPrimitive.content)
        assertEquals(setOf(ids(pair)[0]), photoIds(made))
        val into = post(p, batch, "photos/${ids(lone)[0]}/move", """{"groupId":"${gid(pair)}"}""", ver(lone))
        assertEquals(200, into.status, into.text)
        val now = groups(obj(into.text))
        assertEquals(2, now.size, "the emptied group must go")
        assertTrue(now.none { gid(it) == gid(lone) })
        assertEquals(2, photoIds(now.first { gid(it) == gid(pair) }).size)
        assertEquals(3, groups(obj(status(p, batch).text)).sumOf { ids(it).size })
    }

    @Test
    fun `split moves chosen photos to a new group and refuses all, none and foreign photos`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val pair = gs.first { ids(it).size == 2 }
        val lone = gs.first { ids(it).size == 1 }
        val all = ids(pair).joinToString("\",\"", "[\"", "\"]")
        assertEquals(422, post(p, batch, "groups/${gid(pair)}/split", """{"photoIds":$all}""", ver(pair)).status, "splitting out every photo")
        assertEquals(422, post(p, batch, "groups/${gid(pair)}/split", """{"photoIds":[]}""", ver(pair)).status)
        assertEquals(422, post(p, batch, "groups/${gid(pair)}/split", """{"photoIds":["${ids(lone)[0]}"]}""", ver(pair)).status, "a photo of another group")
        assertEquals(422, post(p, batch, "groups/${gid(pair)}/split", """{"photoIds":["${ids(pair)[0]}","${ids(pair)[0]}"]}""", ver(pair)).status)
        val ok = post(p, batch, "groups/${gid(pair)}/split", """{"photoIds":["${ids(pair)[1]}"]}""", ver(pair))
        assertEquals(200, ok.status, ok.text)
        val out = obj(ok.text)
        assertEquals(3, groups(out).size)
        val made = groups(out).first { gid(it) == out["focus"]!!.jsonPrimitive.content }
        assertEquals(setOf(ids(pair)[1]), photoIds(made))
        assertEquals(setOf(ids(pair)[0]), photoIds(groups(out).first { gid(it) == gid(pair) }))
    }

    @Test
    fun `merge keeps the target's name and tags and removes the source`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val pair = gs.first { ids(it).size == 2 }
        val lone = gs.first { ids(it).size == 1 }
        assertEquals(422, post(p, batch, "merge", """{"sourceId":"${gid(lone)}","targetId":"${gid(lone)}"}""", ver(lone)).status)
        assertEquals(422, post(p, batch, "merge", """{"sourceId":"${gid(lone)}"}""", ver(lone)).status)
        assertEquals(404, post(p, batch, "merge", """{"sourceId":"${gid(lone)}","targetId":"${UUID.randomUUID()}"}""", ver(lone)).status)
        val ok = post(p, batch, "merge", """{"sourceId":"${gid(lone)}","targetId":"${gid(pair)}"}""", ver(lone))
        assertEquals(200, ok.status, ok.text)
        val out = obj(ok.text)
        val only = groups(out).single()
        assertEquals(gid(pair), gid(only))
        assertEquals(pair["name"], only["name"])
        assertEquals(pair["tags"], only["tags"])
        assertEquals(3, ids(only).size)
        assertEquals(gid(pair), out["focus"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a discarded photo leaves every list and can be restored, and an emptied group goes`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val pair = gs.first { ids(it).size == 2 }
        val lone = gs.first { ids(it).size == 1 }
        val gone = ids(lone)[0]
        val d = post(p, batch, "photos/$gone/discard", "", ver(lone))
        assertEquals(200, d.status, d.text)
        val out = obj(d.text)
        assertEquals(1, groups(out).size, "the emptied group must go")
        assertTrue(out["focus"] == null || out["focus"] is kotlinx.serialization.json.JsonNull)
        assertEquals(0, groups(obj(status(p, batch).text)).count { gone in ids(it) })
        val current = UploadClient.call("GET", "$api/api/v1/uploads/current", p.token)
        assertTrue(!current.text.contains(gone), "the batch lists a discarded photo")
        assertEquals(404, post(p, batch, "photos/$gone/discard", "", ver(pair)).status, "discarding twice")
        assertEquals(409, post(p, batch, "photos/${ids(pair)[0]}/restore", """{"groupId":null}""").status, "restoring a live photo")
        val back = post(p, batch, "photos/$gone/restore", """{"groupId":"${gid(pair)}"}""")
        assertEquals(200, back.status, back.text)
        assertEquals(3, ids(groups(obj(back.text)).single()).size)
        val again = post(p, batch, "photos/${ids(pair)[0]}/discard", "", ver(pair))
        assertEquals(200, again.status, again.text)
        val fresh = post(p, batch, "photos/${ids(pair)[0]}/restore", """{"groupId":null,"seed":{"name":"Back again"}}""")
        assertEquals(200, fresh.status, fresh.text)
        assertTrue(groups(obj(fresh.text)).any { it["name"]!!.jsonPrimitive.content == "Back again" })
    }

    @Test
    fun `rearranging needs the upload permission, an owned batch, the review phase and the group version`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val pair = gs.first { ids(it).size == 2 }
        val photo = ids(pair)[0]
        val path = "photos/$photo/move"
        assertEquals(401, post(null, batch, path, """{"groupId":null}""", ver(pair)).status)
        assertEquals(403, post(person(DefaultRoles.VIEWER), batch, path, """{"groupId":null}""", ver(pair)).status)
        assertEquals(404, post(person(), batch, path, """{"groupId":null}""", ver(pair)).status)
        assertEquals(400, post(p, batch, path, """{"groupId":null}""").status)
        val edit = patch(p, batch, gid(pair), """{"name":"Edited"}""", ver(pair))
        assertEquals(200, edit.status, edit.text)
        assertEquals(409, post(p, batch, path, """{"groupId":null}""", ver(pair)).status, "stale group version")
        assertEquals(404, post(p, batch, "photos/${UUID.randomUUID()}/move", """{"groupId":null}""", ver(obj(edit.text))).status)
        tx.executeWithoutResult { em.find(UploadBatch::class.java, UUID.fromString(batch))!!.phase = BatchPhase.PROCESSING }
        assertEquals(409, post(p, batch, path, """{"groupId":null}""", ver(obj(edit.text))).status, "a batch being grouped is locked")
    }

    private fun del(p: Person?, batch: String) = UploadClient.call("DELETE", "$api/api/v1/uploads/$batch", p?.token)
    private fun gownsOf(p: Person) = tx.execute {
        em.createQuery("select g from Gown g where g.createdById = :u", Gown::class.java).setParameter("u", p.id).resultList
    }!!
    private fun auditDetails(action: String) = tx.execute { audit.all().filter { it.action == action }.map { it.detail } }!!
    private fun objectsOf(batch: String) = jdbc.queryForList("select original_object_id as o, thumb_object_id as t from photo where batch_id = ?::uuid", batch)
        .flatMap { listOf(it["o"] as UUID, it["t"] as UUID) }

    @Test
    fun `Save makes one gown per group with tags and search terms, moves the photos, and only the newest gown is New`() {
        val p = person()
        val (batch, _) = twoGroups(p)
        val objects = objectsOf(batch)
        assertEquals(6, objects.size)
        val r = post(p, batch, "save")
        assertEquals(200, r.status, r.text)
        assertEquals(2, obj(r.text)["saved"]!!.jsonPrimitive.int)
        val gowns = gownsOf(p)
        assertEquals(2, gowns.size)
        assertEquals(setOf("Rose Lace"), gowns.map { it.name }.toSet())
        val ids = gowns.map { it.id.toString() }
        assertEquals(3, jdbc.queryForObject("select count(*) from photo where gown_id::text in (${ids.joinToString { "'$it'" }}) and batch_id is null and group_id is null", Int::class.java))
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_batch where id = ?::uuid", Int::class.java, batch))
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_group where batch_id = ?::uuid", Int::class.java, batch))
        assertEquals(0, jdbc.queryForObject("select count(*) from embedding e join photo p on p.id = e.photo_id where p.gown_id::text in (${ids.joinToString { "'$it'" }})", Int::class.java))
        assertTrue(objects.all { store.objects.containsKey(it) }, "kept photos keep both objects")
        gowns.forEach { g ->
            assertEquals(2, jdbc.queryForObject("select count(*) from gown_attribute where gown_id = ?::uuid", Int::class.java, g.id.toString()))
            assertEquals(4, jdbc.queryForObject("select count(*) from gown_term where gown_id = ?::uuid", Int::class.java, g.id.toString()), "rose, lace, a, line")
            for (w in listOf("rose", "lace", "line"))
                assertEquals(1, jdbc.queryForObject("select count(*) from gown_term where gown_id = ?::uuid and term_bidx = ?", Int::class.java, g.id.toString(), bidx.of(BidxDomain.GOWN_TERM, w)))
            val day = jdbc.queryForObject("select day_bidx from gown where id = ?::uuid", ByteArray::class.java, g.id.toString())!!
            assertTrue(day.contentEquals(bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(g.createdAt))))
        }
        val news = tx.execute { em.createQuery("select g from Gown g", Gown::class.java).resultList.filter { it.isNew }.map { it.id } }!!
        assertEquals(1, news.size)
        assertEquals(news.single().toString(), jdbc.queryForObject("select id::text from gown order by seq desc limit 1", String::class.java))
        assertTrue(auditDetails("upload_saved").contains("gowns=2 photos=3"))
    }

    @Test
    fun `Save twice replays the first answer, and refuses an unknown, foreign, empty or unpermitted batch`() {
        val p = person()
        val (batch, _) = twoGroups(p)
        assertEquals(401, post(null, batch, "save").status)
        assertEquals(403, post(person(DefaultRoles.VIEWER), batch, "save").status)
        assertEquals(404, post(person(), batch, "save").status)
        assertEquals(200, post(p, batch, "save").status)
        val again = post(p, batch, "save")
        assertEquals(200, again.status, again.text)
        assertEquals(2, obj(again.text)["saved"]!!.jsonPrimitive.int)
        assertEquals(2, gownsOf(p).size, "a second Save must not add gowns")
        assertEquals(404, post(person(), batch, "save").status, "the replay belongs to the one who saved")
        assertEquals(409, post(p, open(p), "save").status, "an empty batch has nothing to save")
    }

    @Test
    fun `a group without a name stops Save with its index and saves nothing`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val blank = gid(gs[1])
        tx.executeWithoutResult { em.find(UploadGroup::class.java, UUID.fromString(blank))!!.name = "   " }
        val r = post(p, batch, "save")
        assertEquals(422, r.status, r.text)
        assertTrue(r.text.contains("groups[1].name") && r.text.contains("required"), r.text)
        assertEquals(0, gownsOf(p).size)
        assertEquals("review", obj(status(p, batch).text)["phase"]!!.jsonPrimitive.content)
    }

    @Test
    fun `Discard batch deletes photos, groups and objects, is audited, and also works while grouping (Cancel)`() {
        val p = person()
        val (batch, _) = twoGroups(p)
        val objects = objectsOf(batch)
        assertTrue(objects.all { store.objects.containsKey(it) })
        assertEquals(401, del(null, batch).status)
        assertEquals(403, del(person(DefaultRoles.VIEWER), batch).status)
        assertEquals(404, del(person(), batch).status)
        tx.executeWithoutResult { em.find(UploadBatch::class.java, UUID.fromString(batch))!!.phase = BatchPhase.PROCESSING }
        assertEquals(204, del(p, batch).status)
        assertTrue(objects.none { store.objects.containsKey(it) }, "objects must go")
        assertEquals(0, jdbc.queryForObject("select count(*) from photo where batch_id = ?::uuid", Int::class.java, batch))
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_batch where id = ?::uuid", Int::class.java, batch))
        assertEquals(0, jdbc.queryForObject("select count(*) from upload_group where batch_id = ?::uuid", Int::class.java, batch))
        assertTrue(auditDetails("upload_discarded").contains("photos=3"))
        assertEquals(404, del(p, batch).status)
    }

    private fun pairAndLone(gs: List<JsonObject>) = gs.first { ids(it).size == 2 } to gs.first { ids(it).size == 1 }
    private fun ref(g: JsonObject) = """{"id":"${gid(g)}","version":${ver(g)}}"""
    private fun quoted(l: List<String>) = l.joinToString(",") { "\"$it\"" }
    private fun entry(g: JsonObject, name: String, photos: List<String>, extra: String = "") =
        """{"id":"${gid(g)}","version":${ver(g)},"name":"$name","photoIds":[${quoted(photos)}]$extra}"""
    private fun commitBody(groups: List<String>, removed: List<String> = emptyList(), discarded: List<String> = emptyList()) =
        """{"groups":[${groups.joinToString(",")}],"removed":[${removed.joinToString(",")}],"discarded":[${quoted(discarded)}]}"""
    private fun reviewState(batch: String) = jdbc.queryForObject("select count(*) from upload_batch where id = ?::uuid", Int::class.java, batch)

    @Test
    fun `commit saves the staged merge, rename and discard like the same edits through the old endpoints`() {
        val old = person()
        val (b1, g1) = twoGroups(old)
        val (pair1, lone1) = pairAndLone(g1)
        fun current(id: JsonObject) = groups(obj(status(old, b1).text)).first { gid(it) == gid(id) }
        val gone = ids(pair1)[0]
        assertEquals(200, post(old, b1, "photos/$gone/discard", "", ver(pair1)).status)
        assertEquals(200, post(old, b1, "merge", """{"sourceId":"${gid(lone1)}","targetId":"${gid(pair1)}"}""", ver(lone1)).status)
        val renamed = patch(old, b1, gid(pair1), """{"name":"Ivy Satin"}""", ver(current(pair1)))
        assertEquals(200, renamed.status, renamed.text)
        assertEquals(200, post(old, b1, "save").status)

        val p = person()
        val (b2, g2) = twoGroups(p)
        val (pair, lone) = pairAndLone(g2)
        val objects = objectsOf(b2)
        val r = post(p, b2, "commit", commitBody(
            listOf(entry(pair, " Ivy Satin ", listOf(ids(pair)[1], ids(lone)[0]))), listOf(ref(lone)), listOf(ids(pair)[0]),
        ))
        assertEquals(200, r.status, r.text)
        assertEquals(1, obj(r.text)["saved"]!!.jsonPrimitive.int)
        fun shape(u: Person) = gownsOf(u).single().let { it.name to jdbc.queryForObject("select count(*) from photo where gown_id = ?", Int::class.java, it.id) }
        assertEquals(shape(old), shape(p))
        assertEquals("Ivy Satin" to 2, shape(p))
        assertEquals(0, reviewState(b2), "the batch ends")
        assertEquals(4, objects.count { store.objects.containsKey(it) }, "the discarded photo's two objects go, the kept photos keep theirs")
        assertEquals(r.text, post(p, b2, "commit", "{}").text, "a second commit replays the first answer")
    }

    @Test
    fun `commit makes a new group from a split with its own name, tags and description`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val (pair, lone) = pairAndLone(gs)
        val r = post(p, batch, "commit", commitBody(listOf(
            entry(pair, "Pair", listOf(ids(pair)[0])),
            """{"name":"Split off","attributes":[{"type":"fabric","value":"Mikado"}],"description":"Staged words.","photoIds":["${ids(pair)[1]}"]}""",
            entry(lone, "Lone", ids(lone)),
        )))
        assertEquals(200, r.status, r.text)
        assertEquals(3, obj(r.text)["saved"]!!.jsonPrimitive.int)
        val made = gownsOf(p).first { it.name == "Split off" }
        assertEquals("Staged words.", made.description)
        assertEquals(1, jdbc.queryForObject("select count(*) from gown_attribute where gown_id = ?", Int::class.java, made.id))
    }

    @Test
    fun `a stale group version is a 409 and nothing is written`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val (pair, lone) = pairAndLone(gs)
        assertEquals(200, patch(p, batch, gid(pair), """{"name":"Changed elsewhere"}""", ver(pair)).status)
        val r = post(p, batch, "commit", commitBody(listOf(entry(pair, "Mine", ids(pair)), entry(lone, "Lone mine", ids(lone)))))
        assertEquals(409, r.status, r.text)
        assertEquals(0, gownsOf(p).size)
        val after = groups(obj(status(p, batch).text))
        assertEquals(setOf("Changed elsewhere", lone["name"]!!.jsonPrimitive.content), after.map { it["name"]!!.jsonPrimitive.content }.toSet(), "no staged name was written")
        assertEquals("review", obj(status(p, batch).text)["phase"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a photo missing from the staged state, or a group that is not listed, is a 409`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val (pair, lone) = pairAndLone(gs)
        assertEquals(409, post(p, batch, "commit", commitBody(listOf(entry(pair, "A", listOf(ids(pair)[0])), entry(lone, "B", ids(lone))))).status, "a photo left out")
        assertEquals(409, post(p, batch, "commit", commitBody(listOf(entry(pair, "A", ids(pair) + ids(lone))))).status, "a group neither kept nor removed")
        assertEquals(0, gownsOf(p).size)
    }

    @Test
    fun `a failure halfway rolls back every staged write and the batch stays in review`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val (pair, lone) = pairAndLone(gs)
        val before = gs.associate { gid(it) to it["name"]!!.jsonPrimitive.content }
        val staged = commitBody(listOf(entry(pair, "Written first", ids(pair)), entry(lone, "Written second", ids(lone))))
        fun unchanged() {
            val now = obj(status(p, batch).text)
            assertEquals("review", now["phase"]!!.jsonPrimitive.content)
            assertEquals(before, groups(now).associate { gid(it) to it["name"]!!.jsonPrimitive.content })
            assertEquals(3, groups(now).sumOf { ids(it).size })
            assertEquals(0, gownsOf(p).size)
        }
        // A failure after the Group writes were flushed: the database refuses the first Gown.
        jdbc.execute("create or replace function klei_boom() returns trigger as \$\$ begin raise exception 'boom'; end \$\$ language plpgsql")
        jdbc.execute("create trigger klei_boom before insert on gown for each row execute function klei_boom()")
        try {
            assertEquals(500, post(p, batch, "commit", staged).status)
        } finally {
            jdbc.execute("drop trigger klei_boom on gown")
        }
        unchanged()
        val bad = post(p, batch, "commit", commitBody(listOf(
            entry(pair, "Written first", ids(pair)),
            entry(lone, "Bad tag", ids(lone), ""","attributes":[{"type":"fabric","value":"No such fabric"}]"""),
        )))
        assertEquals(422, bad.status, bad.text)
        assertTrue(bad.text.contains("groups[1].attributes"), bad.text)
        assertFalse(bad.text.contains("No such fabric") || bad.text.contains("Written first"), "request text echoed")
        val blank = post(p, batch, "commit", commitBody(listOf(entry(pair, "Fine", ids(pair)), entry(lone, "  ", ids(lone)))))
        assertEquals(422, blank.status, blank.text)
        assertTrue(blank.text.contains("groups[1].name"), blank.text)
        unchanged()
        assertEquals(200, post(p, batch, "commit", staged).status, "the same body succeeds once the failure is gone")
    }

    @Test
    fun `commit needs the upload permission, an owned batch and the review phase`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val (pair, lone) = pairAndLone(gs)
        val body = commitBody(listOf(entry(pair, "A", ids(pair)), entry(lone, "B", ids(lone))))
        assertEquals(401, post(null, batch, "commit", body).status)
        assertEquals(403, post(person(DefaultRoles.VIEWER), batch, "commit", body).status)
        assertEquals(404, post(person(), batch, "commit", body).status)
        assertEquals(422, post(p, batch, "commit", """{"groups":[]}""").status)
        tx.executeWithoutResult { em.find(UploadBatch::class.java, UUID.fromString(batch))!!.phase = BatchPhase.PROCESSING }
        assertEquals(409, post(p, batch, "commit", body).status)
    }

    private fun describeUsage(p: Person) = tx.execute {
        em.createQuery("select u from AiUsage u", AiUsage::class.java).resultList.filter { it.purpose == AiPurpose.DESCRIBE && it.userId == p.id }.associate { it.id to it.prompt }
    }!!

    @Test
    fun `Rewrite runs one describe call outside a transaction, stores nothing and labels the usage row with the group`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val (pair, _) = pairAndLone(gs)
        stub.chatAnswer = { """{"name":"Ignored","attributes":{"silhouette":["A-line"]},"description":"  Fresh words.  "}""" }
        val calls = chats()
        val rows = describeUsage(p)
        val r = post(p, batch, "groups/${gid(pair)}/rewrite", """{"photoIds":[${quoted(ids(pair))}]}""")
        assertEquals(200, r.status, r.text)
        assertEquals("Fresh words.", obj(r.text)["description"]!!.jsonPrimitive.content)
        assertFalse(r.text.contains("Ignored"), "only the description comes back")
        assertEquals(1, chats() - calls)
        assertEquals(listOf("group ${gid(pair)}"), (describeUsage(p) - rows.keys).values.toList())
        assertEquals(pair["description"], groups(obj(status(p, batch).text)).first { gid(it) == gid(pair) }["description"], "nothing is stored before commit")
        assertEquals(pair["tags"], groups(obj(status(p, batch).text)).first { gid(it) == gid(pair) }["tags"])
        val body = chatBodies().last()
        assertFalse(body.contains(batch) || ids(pair).any { body.contains(it) } || body.contains("gown.jpg"), "id or file name reached the provider")
    }

    @Test
    fun `Rewrite answers 502 when the provider fails, and refuses wrong callers, phases and empty input`() {
        val p = person()
        val (batch, gs) = twoGroups(p)
        val (pair, _) = pairAndLone(gs)
        val path = "groups/${gid(pair)}/rewrite"
        val body = """{"photoIds":[${quoted(ids(pair))}]}"""
        assertEquals(401, post(null, batch, path, body).status)
        assertEquals(403, post(person(DefaultRoles.VIEWER), batch, path, body).status)
        assertEquals(404, post(person(), batch, path, body).status)
        assertEquals(422, post(p, batch, path, """{"photoIds":[]}""").status)
        assertEquals(404, post(p, batch, path, """{"photoIds":["${UUID.randomUUID()}"]}""").status)
        stub.chatsLeft.set(0)
        val failed = post(p, batch, path, body)
        assertEquals(502, failed.status, failed.text)
        assertFalse(failed.text.contains("PROVIDER-SECRET"), "provider text echoed")
        stub.chatsLeft.set(Int.MAX_VALUE)
        tx.executeWithoutResult { em.find(UploadBatch::class.java, UUID.fromString(batch))!!.phase = BatchPhase.PROCESSING }
        assertEquals(409, post(p, batch, path, body).status)
    }

    @Test
    fun `a tag on a saved gown cannot be removed from the Taxonomy and the 409 counts its use`() {
        val p = person()
        val (batch, _) = twoGroups(p)
        assertEquals(200, post(p, batch, "save").status)
        val admin = token(TestSupport.ADMIN_EMAIL, TestSupport.ADMIN_PASSWORD)
        val list = client().api("GET", "/api/v1/taxonomy", null, admin).body
        val m = Regex(""""id":"([^"]+)","type":"silhouette","value":"A-line","version":(\d+)""").find(list)!!.groupValues
        val r = client().api("PUT", "/api/v1/taxonomy", """{"op":"remove","id":"${m[1]}"}""", admin, mapOf("If-Match" to m[2]))
        assertEquals(409, r.status, r.body)
        assertTrue(Regex(""""usedBy":(\d+)""").find(r.body)!!.groupValues[1].toInt() >= 2, r.body)
    }
}
