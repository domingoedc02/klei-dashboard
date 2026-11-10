package co.klei.app.notification

import co.klei.app.TestSupport
import co.klei.app.identity.AppUser
import co.klei.app.identity.Prefs
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.mail.RecordingMail
import co.klei.app.mail.RecordingMailConfig
import co.klei.app.upload.FakeStore
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.UserStatus
import co.klei.core.mail.MailTemplate
import co.klei.core.notification.NotificationType
import jakarta.persistence.EntityManager
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment.RANDOM_PORT
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Import
import org.springframework.context.annotation.Primary
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.junit.jupiter.Container
import org.testcontainers.junit.jupiter.Testcontainers
import org.testcontainers.postgresql.PostgreSQLContainer
import java.net.ServerSocket
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 11.13: the digest job. Time is the `now` it is given; events are stamped with the real clock, so each run is "later" than they are. */
@Testcontainers
@Import(RecordingMailConfig::class, DigestJobIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class DigestJobIT {
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
    }

    @Autowired lateinit var users: UserService
    @Autowired lateinit var roles: RoleService
    @Autowired lateinit var tx: TransactionTemplate
    @Autowired lateinit var em: EntityManager
    @Autowired lateinit var mail: RecordingMail
    @Autowired lateinit var service: NotificationService

    private class Person(val id: UUID, val email: String)

    private fun person(digest: String, inquiry: Boolean = true, ai: Boolean = false, team: Boolean = false, status: UserStatus = UserStatus.ACTIVE): Person {
        val email = "mail-${UUID.randomUUID()}@example.test"
        val rid = roles.roles().first { it.name == DefaultRoles.STAFF }.id
        val id = tx.execute {
            users.create("Mail Person", email, "Mail-pass-1", rid, status, true).also {
                it.prefs = Prefs(rev = 1, timezone = null, dateFormat = "MM/DD/YYYY", startPage = "dashboard", enterToSend = false, newInquiry = true, aiFinished = true, teamActivity = true,
                    emailNewInquiry = inquiry, emailAiFinished = ai, emailTeamActivity = team, digest = digest)
            }.id
        }!!
        return Person(id, email)
    }

    private fun notify(p: Person, type: NotificationType, title: String) = tx.executeWithoutResult { service.notify(type, listOf(p.id), title, null) }
    private fun mailsTo(p: Person) = mail.sent.filter { it.to == p.email }

    @Autowired lateinit var job: DigestJob

    // The cursor keeps milliseconds.
    private val t0 get() = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MILLIS)
    private fun cursor(p: Person) = tx.execute { em.find(NotificationDigest::class.java, p.id)?.lastDigestAt }
    /** Starts the cursor (first sight), then makes events newer than it. */
    private fun started(digest: String, inquiry: Boolean = true, ai: Boolean = false): Person = person(digest, inquiry, ai).also { job.runOnce(t0.minusSeconds(1)) }

    @Test fun `first sight only starts the cursor`() {
        val p = person("hourly")
        assertEquals(0, job.runOnce(t0))
        assertTrue(cursor(p) != null)
        assertEquals(emptyList(), mailsTo(p))
    }

    @Test fun `one DIGEST mail lists the switched-on events newest first, then the cursor moves and a rerun sends nothing`() {
        val p = started("hourly")
        notify(p, NotificationType.NEW_INQUIRY, "First")
        notify(p, NotificationType.AI_FINISHED, "Switched off by email")
        notify(p, NotificationType.NEW_INQUIRY, "Second")
        val later = t0.plusSeconds(7200)
        assertEquals(1, job.runOnce(later))
        val m = mailsTo(p).single()
        assertEquals(MailTemplate.DIGEST, m.template)
        assertEquals(mapOf("items" to "- Second\n- First", "more" to ""), m.model)
        assertEquals(later, cursor(p))
        assertEquals(0, job.runOnce(later))
        assertEquals(0, job.runOnce(later.plusSeconds(60)), "not due again within the hour")
        assertEquals(1, mailsTo(p).size)
    }

    @Test fun `more than 50 events show 50 and then how many more`() {
        val p = started("hourly")
        tx.executeWithoutResult { repeat(53) { service.notify(NotificationType.NEW_INQUIRY, listOf(p.id), "Event $it", null) } }
        assertEquals(1, job.runOnce(t0.plusSeconds(7200)))
        val m = mailsTo(p).single().model
        assertEquals(50, m.getValue("items").lines().size)
        assertEquals("- Event 52", m.getValue("items").lines().first())
        assertEquals("and 3 more", m.getValue("more"))
    }

    @Test fun `nothing new sends nothing but the cursor still moves`() {
        val p = started("hourly")
        val later = t0.plusSeconds(7200)
        assertEquals(0, job.runOnce(later))
        assertEquals(later, cursor(p))
        assertEquals(emptyList(), mailsTo(p))
    }

    @Test fun `Never, Real-time and a User who is not Active are not served`() {
        val others = listOf(person("never"), person("realtime"), person("hourly", status = UserStatus.INVITED))
        others.forEach { notify(it, NotificationType.NEW_INQUIRY, "x") }
        job.runOnce(t0.plusSeconds(7200))
        others.forEach { assertEquals(null, cursor(it)); assertEquals(emptyList(), mailsTo(it).filter { m -> m.template == MailTemplate.DIGEST }) }
    }

    @Test fun `a refused send is logged and skipped but the cursor still advances`() {
        val p = started("hourly")
        notify(p, NotificationType.NEW_INQUIRY, "x")
        val later = t0.plusSeconds(7200)
        mail.failSends = true
        try { assertEquals(0, job.runOnce(later)) } finally { mail.failSends = false }
        assertEquals(later, cursor(p))
        assertEquals(0, job.runOnce(later.plusSeconds(7200)))
    }

    @Test fun `a cursor another instance holds is skipped, not waited for, and served on the next run`() {
        val p = started("hourly")
        notify(p, NotificationType.NEW_INQUIRY, "x")
        val held = CountDownLatch(1)
        val release = CountDownLatch(1)
        val pool = Executors.newSingleThreadExecutor()
        try {
            val other = pool.submit {
                tx.executeWithoutResult {
                    em.createQuery("select d from NotificationDigest d where d.id = :id", NotificationDigest::class.java).setParameter("id", p.id)
                        .setLockMode(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE).resultList
                    held.countDown()
                    release.await(30, TimeUnit.SECONDS)
                }
            }
            assertTrue(held.await(30, TimeUnit.SECONDS))
            val later = t0.plusSeconds(7200)
            assertEquals(0, job.runOnce(later))
            assertEquals(emptyList(), mailsTo(p))
            release.countDown()
            other.get(30, TimeUnit.SECONDS)
            assertEquals(1, job.runOnce(later))
            assertEquals(1, mailsTo(p).size)
        } finally {
            release.countDown()
            pool.shutdownNow()
        }
    }
}
