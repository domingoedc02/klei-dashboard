package co.klei.app.notification

import co.klei.app.identity.AppUser
import co.klei.core.identity.UserStatus
import co.klei.core.mail.MailPort
import co.klei.core.mail.MailTemplate
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/**
 * FR-34, digest email: every 5 minutes, mails each Active User on Hourly, Daily or Weekly the bell titles of the events they switched
 * on by email since their last digest. The cursor row is locked `for update skip locked`, so a second instance skips a User being served.
 * shortcut: reads every User each run (a studio team is a handful); a User's first sight only starts the cursor (events in the minutes between saving Preferences and that run are not digested);
 * the digest looks back at most [LOOKBACK] and scans the newest [SCAN] rows. Titles only, never client data.
 */
@Component
class DigestJob(private val em: EntityManager, txm: PlatformTransactionManager, private val mail: MailPort) {
    private val log = LoggerFactory.getLogger(DigestJob::class.java)
    private val tx = TransactionTemplate(txm)

    @Scheduled(cron = "0 */5 * * * *")
    fun every5Minutes() {
        val sent = runOnce(Instant.now())
        if (sent > 0) log.info("digest mails queued: {}", sent)
    }

    /** Returns how many digest mails were queued. One User failing never stops the rest. */
    fun runOnce(now: Instant): Int = candidates().sumOf { id ->
        try {
            tx.execute { serve(id, now) } ?: 0
        } catch (e: Exception) {
            log.warn("digest for one user failed: {}", e.javaClass.simpleName) // class name only: the message may hold the address
            0
        }
    }

    private fun candidates(): List<UUID> = tx.execute {
        em.createQuery("select u from AppUser u", AppUser::class.java).resultList
            .filter { it.status == UserStatus.ACTIVE && it.prefs?.digest in PERIODIC }.map { it.id }
    }!!

    private fun serve(id: UUID, now: Instant): Int {
        val u = em.find(AppUser::class.java, id) ?: return 0
        val p = u.prefs ?: return 0
        // Hibernate reads -2 as SKIP_LOCKED: a cursor another instance holds comes back empty, and that User is left to it.
        val cursor = em.createQuery("select d from NotificationDigest d where d.id = :id", NotificationDigest::class.java)
            .setParameter("id", id).setLockMode(LockModeType.PESSIMISTIC_WRITE).setHint("jakarta.persistence.lock.timeout", -2)
            .resultList.firstOrNull()
        if (cursor == null) {
            if (em.find(NotificationDigest::class.java, id) == null) em.persist(NotificationDigest(id, now)) // first sight: start the cursor
            return 0
        }
        if (!DigestDue.due(p.digest, cursor.lastDigestAt, now, p.timezone?.let(ZoneId::of) ?: ZoneOffset.UTC)) return 0
        val since = maxOf(cursor.lastDigestAt, now.minus(LOOKBACK))
        cursor.lastDigestAt = now
        val titles = em.createQuery("select n from Notification n where n.userId = :u order by n.seq desc", Notification::class.java)
            .setParameter("u", id).setMaxResults(SCAN).resultList
            .filter { it.createdAt.isAfter(since) && !it.createdAt.isAfter(now) && EmailNotifier.wants(p, it.type) }
            .map { EmailNotifier.oneLine(it.title) }
        if (titles.isEmpty()) return 0
        val more = if (titles.size > MAX_ITEMS) "and ${titles.size - MAX_ITEMS} more" else ""
        try {
            mail.send(MailTemplate.DIGEST, u.email, mapOf("items" to titles.take(MAX_ITEMS).joinToString("\n") { "- $it" }, "more" to more))
        } catch (e: Exception) {
            log.warn("digest mail not sent: {}", e.javaClass.simpleName) // the cursor still advances: no retry storm
            return 0
        }
        return 1
    }

    companion object {
        const val MAX_ITEMS = 50
        const val SCAN = 500
        val LOOKBACK: Duration = Duration.ofDays(8)
        val PERIODIC = setOf("hourly", "daily", "weekly")
    }
}
