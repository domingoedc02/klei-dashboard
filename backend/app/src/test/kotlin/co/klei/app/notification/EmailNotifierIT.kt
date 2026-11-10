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

/** Story 11.13: real-time email from the notification hook. Titles only; nothing leaves before the commit. */
@Testcontainers
@Import(RecordingMailConfig::class, EmailNotifierIT.Config::class)
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = RANDOM_PORT)
class EmailNotifierIT {
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

    @Test fun `real-time with the event switch on sends one NOTIFY mail with the title and nothing else`() {
        val p = person("realtime")
        notify(p, NotificationType.NEW_INQUIRY, "New inquiry from Wren   Calloway\nBcc: x")
        val m = mailsTo(p).single()
        assertEquals(MailTemplate.NOTIFY, m.template)
        assertEquals(mapOf("title" to "New inquiry from Wren Calloway Bcc: x"), m.model)
    }

    @Test fun `the switch for that event, Never, a periodic digest and a User who never saved all send nothing`() {
        val p = person("realtime", inquiry = false, ai = true)
        notify(p, NotificationType.NEW_INQUIRY, "off")
        notify(p, NotificationType.TEAM_ACTIVITY, "off too")
        assertEquals(emptyList(), mailsTo(p))
        for (d in listOf("never", "hourly", "daily", "weekly")) person(d).let { notify(it, NotificationType.NEW_INQUIRY, d); assertEquals(emptyList(), mailsTo(it), d) }
        val rid = roles.roles().first { it.name == DefaultRoles.STAFF }.id
        val fresh = tx.execute { users.create("No Prefs", "np-${UUID.randomUUID()}@example.test", "Mail-pass-1", rid, UserStatus.ACTIVE, true) }!!
        tx.executeWithoutResult { service.notify(NotificationType.NEW_INQUIRY, listOf(fresh.id), "x", null) }
        assertTrue(mail.sent.none { it.to == fresh.email })
    }

    @Test fun `a User who is not Active gets no mail`() {
        val p = person("realtime", status = UserStatus.INVITED)
        notify(p, NotificationType.NEW_INQUIRY, "x")
        assertEquals(emptyList(), mailsTo(p))
    }

    @Test fun `the mail leaves after the commit and a rollback sends none`() {
        val p = person("realtime")
        tx.executeWithoutResult { service.notify(NotificationType.NEW_INQUIRY, listOf(p.id), "inside", null); assertEquals(emptyList(), mailsTo(p)) }
        assertEquals(1, mailsTo(p).size)
        tx.executeWithoutResult { s -> service.notify(NotificationType.NEW_INQUIRY, listOf(p.id), "rolled back", null); s.setRollbackOnly() }
        assertEquals(1, mailsTo(p).size)
    }

    @Test fun `a refused send never breaks the notification`() {
        val p = person("realtime")
        mail.failSends = true
        try { notify(p, NotificationType.NEW_INQUIRY, "still in the bell") } finally { mail.failSends = false }
        assertEquals(emptyList(), mailsTo(p))
        assertEquals(1L, em.createQuery("select count(n) from Notification n where n.userId = :u", Long::class.javaObjectType).setParameter("u", p.id).singleResult)
    }
}
