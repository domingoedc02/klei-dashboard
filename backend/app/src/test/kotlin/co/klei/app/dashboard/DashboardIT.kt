package co.klei.app.dashboard

import co.klei.app.TestSupport
import co.klei.app.auth.AuthWebClient
import co.klei.app.auth.AuthWebClient.Companion.field
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import co.klei.app.gown.Gown
import co.klei.app.inquiry.Direction
import co.klei.app.inquiry.Message
import co.klei.app.identity.Role
import co.klei.app.identity.RolePermission
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.upload.BatchPhase
import co.klei.app.upload.FakeStore
import co.klei.app.upload.Images
import co.klei.app.upload.ObjectVault
import co.klei.app.upload.Photo
import co.klei.app.upload.StoredObject
import co.klei.app.upload.UploadBatch
import co.klei.app.upload.UploadClient
import co.klei.app.upload.UploadGroup
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.Permission
import co.klei.core.identity.UserStatus
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.DayBucket
import jakarta.persistence.EntityManager
import jakarta.persistence.PersistenceContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
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
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.temporal.ChronoUnit
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 9.1: one read for the home screen; each widget appears only for a Role that may see its data. */
@Testcontainers
@Import(RecordingMailConfig::class, DashboardIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class DashboardIT {
    @TestConfiguration
    class Config {
        @Bean @Primary fun fakeStore() = FakeStore()
    }

    companion object {
        @Container @JvmStatic val pg = PostgreSQLContainer("postgres:18.6")
        private val authPort = ServerSocket(0).use { it.localPort }
        private const val PW = "Dash-pass-1"
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
    @Autowired lateinit var vault: ObjectVault
    @PersistenceContext lateinit var em: EntityManager

    private val api get() = "http://127.0.0.1:${ctx.webServer!!.port}"
    private fun tokenFor(roleId: UUID): String {
        val email = "da-${UUID.randomUUID()}@example.test"
        tx.execute { users.create("Dana Dash", email, PW, roleId, UserStatus.ACTIVE, true) }
        val c = AuthWebClient("http://127.0.0.1:$authPort", api)
        return field(c.exchange(c.signIn(email, PW)).body, "accessToken")!!
    }
    private fun token(role: String) = tokenFor(roles.roles().first { it.name == role }.id)
    private fun roleOf(name: String, vararg perms: Permission): UUID {
        val id = UUID.randomUUID()
        tx.execute { em.persist(Role(id, name)); em.flush(); perms.forEach { em.persist(RolePermission(UUID.randomUUID(), id, it)) } }
        return id
    }

    private fun json(method: String, path: String, token: String?, body: String? = null) =
        UploadClient.call(method, "$api$path", token, body?.toByteArray(), if (body != null) mapOf("Content-Type" to "application/json") else emptyMap())
    private fun dash(token: String): JsonObject {
        val r = json("GET", "/api/v1/dashboard", token)
        assertEquals(200, r.status, r.text)
        return Json.parseToJsonElement(r.text).jsonObject
    }
    private fun myId(token: String) = UUID.fromString(Json.parseToJsonElement(json("GET", "/api/v1/me", token).text).jsonObject["id"]!!.jsonPrimitive.content)

    private fun seed(name: String, daysAgo: Long): UUID = seedAt(name, Instant.now().minus(daysAgo, ChronoUnit.DAYS))

    private fun seedAt(name: String, at: Instant, photos: Int = 0): UUID {
        val gownId = UUID.randomUUID()
        tx.execute {
            em.persist(Gown(gownId, name, "A gown", 90, at, true, null, bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(at)), bidx.of(BidxDomain.IDEM, "save|$gownId")))
            em.flush()
            repeat(photos) { i ->
                val original = vault.put(Images.jpeg(80, 60))
                val thumb = vault.put(Images.solid(10 * i, 20, 30))
                for (k in listOf(original, thumb)) em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, Instant.now()))
                val pid = UUID.randomUUID()
                val p = Photo(pid, null, original.id, thumb.id, bidx.of(BidxDomain.IDEM, pid.toString()), "p$i.jpg", "image/jpeg", 1L, at.plusSeconds(i.toLong()))
                p.gownId = gownId
                em.persist(p)
            }
        }
        return gownId
    }

    /** The first IN Message of [inquiry] is moved to [at]; an OUT Message follows [replyAfterHours] later. */
    private fun answer(inquiry: UUID, at: Instant, replyAfterHours: Long) {
        tx.executeWithoutResult {
            em.createQuery("select m from Message m where m.inquiryId = :i", Message::class.java).setParameter("i", inquiry).singleResult.createdAt = at
            em.persist(Message(UUID.randomUUID(), inquiry, null, Direction.OUT, "Reply", null, at.plus(replyAfterHours, ChronoUnit.HOURS)))
        }
    }
    private fun inquire(token: String, name: String): UUID {
        val r = json("POST", "/api/v1/inquiries", token, """{"clientName":"$name","clientEmail":"da-${UUID.randomUUID()}@example.test","subject":"Subject of $name","body":"Hello"}""")
        assertEquals(201, r.status, r.text)
        return UUID.fromString(Json.parseToJsonElement(r.text).jsonObject["id"]!!.jsonPrimitive.content)
    }
    private fun setBatch(owner: String, phase: BatchPhase?) {
        val uid = myId(owner)
        jdbc.update("delete from upload_batch where user_id = ?", uid)
        if (phase != null) tx.execute { em.persist(UploadBatch(UUID.randomUUID(), uid, phase, Instant.now())) }
    }

    private val admin get() = signed.getValue("admin")
    private val staff get() = signed.getValue("staff")
    private val viewer get() = signed.getValue("viewer")
    private val replyOnly get() = signed.getValue("replyOnly")
    private val neither get() = signed.getValue("neither")

    private val logs = ListAppender<ILoggingEvent>()
    private val root = LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME) as Logger

    @AfterEach fun release() { root.detachAppender(logs); logs.stop() }

    @BeforeEach
    fun seeded() {
        logs.list.clear(); logs.start(); root.addAppender(logs)
        if (signed.isEmpty()) {
            signed["admin"] = token(DefaultRoles.ADMIN); signed["staff"] = token(DefaultRoles.STAFF); signed["viewer"] = token(DefaultRoles.VIEWER)
            signed["replyOnly"] = tokenFor(roleOf("Mailer", Permission.PERM_REPLY))
            signed["neither"] = tokenFor(roleOf("Uploader", Permission.PERM_UPLOAD_IMAGES))
        }
        jdbc.update("delete from upload_batch")
        jdbc.update("delete from photo where gown_id is not null")
        jdbc.update("delete from gown")
        jdbc.update("delete from inquiry")
        jdbc.update("delete from client")
    }

    @Test fun `a token is required`() {
        assertEquals(401, json("GET", "/api/v1/dashboard", null).status)
    }

    @Test fun `an empty workspace answers zeroes, no rows and idle`() {
        val d = dash(admin)
        assertEquals(0, d["recentGowns"]!!.jsonArray.size)
        assertEquals(0, d["totalGowns"]!!.jsonPrimitive.long)
        assertEquals(0, d["newThisWeek"]!!.jsonPrimitive.long)
        assertEquals(0, d["photosThisMonth"]!!.jsonPrimitive.long)
        assertEquals(0, d["gownsThisMonth"]!!.jsonPrimitive.long)
        assertFalse("avgReplySeconds" in d || "prevAvgReplySeconds" in d)
        assertFalse("oldestUnreadAt" in d["inquiries"]!!.jsonObject)
        assertEquals("idle", d["aiStatus"]!!.jsonObject["phase"]!!.jsonPrimitive.content)
        assertEquals(0, d["inquiries"]!!.jsonObject["unread"]!!.jsonPrimitive.long)
        assertEquals(0, d["inquiries"]!!.jsonObject["latest"]!!.jsonArray.size)
        assertEquals(0, d["errors"]!!.jsonArray.size)
    }

    @Test fun `Gown figures list the five newest, total equals the Gallery total, this week counts seven days`() {
        val names = listOf("G1" to 30L, "G2" to 20L, "G3" to 6L, "G4" to 3L, "G5" to 2L, "G6" to 1L, "G7" to 0L)
        names.forEach { (n, d) -> seed(n, d) }
        val d = dash(staff)
        assertEquals(listOf("G7", "G6", "G5", "G4", "G3"), d["recentGowns"]!!.jsonArray.map { it.jsonObject["name"]!!.jsonPrimitive.content })
        assertEquals(7, d["totalGowns"]!!.jsonPrimitive.long)
        assertEquals(5, d["newThisWeek"]!!.jsonPrimitive.long)
        val gallery = Json.parseToJsonElement(json("POST", "/api/v1/gowns/query", staff, "{}").text).jsonObject
        assertEquals(gallery["total"]!!.jsonPrimitive.long, d["totalGowns"]!!.jsonPrimitive.long)
    }

    @Test fun `Inquiry figures hold the unread count and the three newest New ones, shrinking once read`() {
        val ids = listOf("Ada", "Bea", "Cy", "Di").map { inquire(staff, it) }
        val d = dash(staff)["inquiries"]!!.jsonObject
        assertEquals(4, d["unread"]!!.jsonPrimitive.long)
        assertEquals(listOf("Di", "Cy", "Bea"), d["latest"]!!.jsonArray.map { it.jsonObject["clientName"]!!.jsonPrimitive.content })
        ids.forEach { assertEquals(204, json("POST", "/api/v1/inquiries/$it/read", staff).status) }
        val after = dash(staff)["inquiries"]!!.jsonObject
        assertEquals(0, after["unread"]!!.jsonPrimitive.long)
        assertEquals(0, after["latest"]!!.jsonArray.size)
    }

    @Test fun `a Viewer sees Gown figures and AI status, never Inquiries`() {
        seed("G1", 1); inquire(staff, "Ada")
        val d = dash(viewer)
        assertEquals(setOf("recentGowns", "totalGowns", "newThisWeek", "photosThisMonth", "gownsThisMonth", "aiStatus", "errors"), d.keys)
    }

    @Test fun `a Role with Reply only sees Inquiries and AI status, no Gown field`() {
        seed("G1", 1); inquire(staff, "Ada")
        val d = dash(replyOnly)
        assertEquals(setOf("aiStatus", "inquiries", "errors"), d.keys)
        assertEquals(1, d["inquiries"]!!.jsonObject["unread"]!!.jsonPrimitive.long)
        assertTrue("oldestUnreadAt" in d["inquiries"]!!.jsonObject)
    }

    @Test fun `a Role with Reply only gets the reply figure and still no Gown field or month figure`() {
        seed("G1", 1)
        answer(inquire(staff, "Ada"), Instant.now().minus(2, ChronoUnit.DAYS), 2)
        val d = dash(replyOnly)
        assertEquals(setOf("aiStatus", "inquiries", "avgReplySeconds", "errors"), d.keys)
        assertEquals(7200, d["avgReplySeconds"]!!.jsonPrimitive.long)
    }

    @Test fun `month figures count Gowns and Photos saved from the 1st of the UTC month, not the last day of the previous one`() {
        val now = Instant.now()
        val firstOfMonth = YearMonth.from(now.atZone(ZoneOffset.UTC)).atDay(1).atStartOfDay(ZoneOffset.UTC).toInstant()
        repeat(6) { seedAt("M$it", now, photos = 7) }
        seedAt("Edge", firstOfMonth.minusSeconds(1), photos = 3)
        repeat(89) { seedAt("Old$it", now.minus(80, ChronoUnit.DAYS)) }
        val d = dash(staff)
        assertEquals(96, d["totalGowns"]!!.jsonPrimitive.long)
        assertTrue(d["newThisWeek"]!!.jsonPrimitive.long >= 6)
        assertEquals(42, d["photosThisMonth"]!!.jsonPrimitive.long)
        assertEquals(6, d["gownsThisMonth"]!!.jsonPrimitive.long)
    }

    @Test fun `the oldest unread Inquiry and the reply means are reported, and reading the oldest moves the figure on`() {
        val first = inquire(staff, "Ada")
        val second = inquire(staff, "Bea")
        val now = Instant.now()
        answer(first, now.minus(1, ChronoUnit.DAYS), 1)
        answer(second, now.minus(40, ChronoUnit.DAYS), 3)
        val d = dash(admin)
        assertEquals(3600, d["avgReplySeconds"]!!.jsonPrimitive.long)
        assertEquals(10800, d["prevAvgReplySeconds"]!!.jsonPrimitive.long)
        assertEquals(2, d["inquiries"]!!.jsonObject["unread"]!!.jsonPrimitive.long)
        assertTrue("oldestUnreadAt" in d["inquiries"]!!.jsonObject)
        assertEquals(204, json("POST", "/api/v1/inquiries/$first/read", staff).status)
        assertEquals(1, dash(admin)["inquiries"]!!.jsonObject["unread"]!!.jsonPrimitive.long)
    }

    @Test fun `a failing reply-time read names the inquiries widget and logs the exception class, never row text`() {
        val id = inquire(staff, "Sentinel Sam")
        jdbc.update("update message set created_at_ct = ? where inquiry_id = ?", byteArrayOf(1, 2, 3), id)
        val d = dash(admin)
        assertEquals(listOf("inquiries"), d["errors"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertFalse("inquiries" in d)
        val lines = logs.list.map { it.formattedMessage + (it.throwableProxy?.message ?: "") }
        assertTrue(lines.any { it.contains("dashboard widget failed") && it.contains("type=") })
        assertTrue(lines.none { it.contains("Sentinel Sam") || it.contains("Subject of Sentinel Sam") })
    }

    @Test fun `a Role with neither Permission gets only the AI status`() {
        seed("G1", 1); inquire(staff, "Ada")
        assertEquals(setOf("aiStatus", "errors"), dash(neither).keys)
    }

    @Test fun `AI status follows the caller's own batch and nobody else's`() {
        setBatch(admin, BatchPhase.PROCESSING)
        val mine = dash(admin)["aiStatus"]!!.jsonObject
        assertEquals("processing", mine["phase"]!!.jsonPrimitive.content)
        assertEquals(1, mine["step"]!!.jsonPrimitive.int)
        assertEquals("idle", dash(staff)["aiStatus"]!!.jsonObject["phase"]!!.jsonPrimitive.content)
        setBatch(admin, BatchPhase.REVIEW)
        assertEquals(setOf("phase", "groups", "lowConfidence"), dash(admin)["aiStatus"]!!.jsonObject.keys)
        assertEquals("review", dash(admin)["aiStatus"]!!.jsonObject["phase"]!!.jsonPrimitive.content)
        setBatch(admin, BatchPhase.ERROR)
        assertEquals("error", dash(admin)["aiStatus"]!!.jsonObject["phase"]!!.jsonPrimitive.content)
        setBatch(admin, BatchPhase.EMPTY)
        assertEquals("idle", dash(admin)["aiStatus"]!!.jsonObject["phase"]!!.jsonPrimitive.content)
        setBatch(admin, null)
    }

    @Test fun `Review counts the groups and those under 80`() {
        setBatch(admin, BatchPhase.REVIEW)
        val batch = jdbc.queryForObject("select id from upload_batch where user_id = ?", UUID::class.java, myId(admin))!!
        tx.execute { listOf(95, 90, 85, 80, 79, 60, 50, 92, 88, 70).forEachIndexed { i, c -> em.persist(UploadGroup(UUID.randomUUID(), batch, "Group $i", c, i)) } }
        val ai = dash(admin)["aiStatus"]!!.jsonObject
        assertEquals("review", ai["phase"]!!.jsonPrimitive.content)
        assertEquals(10, ai["groups"]!!.jsonPrimitive.int)
        assertEquals(4, ai["lowConfidence"]!!.jsonPrimitive.int)
        setBatch(admin, null)
    }
}
