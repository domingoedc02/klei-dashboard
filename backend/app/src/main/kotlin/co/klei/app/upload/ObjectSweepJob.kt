package co.klei.app.upload

import co.klei.app.inquiry.Attachment
import co.klei.core.storage.ObjectStorePort
import jakarta.persistence.EntityManager
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID

class SweepResult(val objects: Int, val rows: Int)

/**
 * Nightly cleanup of what a crash or a failed delete left behind (architecture §5.5):
 * bucket objects with no `stored_object` row, and `stored_object` rows nothing refers to. Both wait [GRACE] first,
 * so an upload still between its S3 write and its commit is never touched.
 */
@Component
class ObjectSweepJob(
    private val em: EntityManager,
    txm: PlatformTransactionManager,
    private val store: ObjectStorePort,
    private val vault: ObjectVault,
) {
    private val log = LoggerFactory.getLogger(ObjectSweepJob::class.java)
    private val tx = TransactionTemplate(txm)
    internal var clock: Clock = Clock.systemUTC()

    @Scheduled(cron = "0 30 3 * * *")
    fun nightly() {
        val r = sweep(clock.instant())
        log.info("object sweep removed {} objects and {} rows", r.objects, r.rows)
    }

    fun sweep(now: Instant): SweepResult {
        val cutoff = now.minus(GRACE)
        dropUnsentAttachments(cutoff)
        val rows = unreferencedRows(cutoff)
        if (rows.isNotEmpty()) tx.executeWithoutResult {
            em.createQuery("delete from StoredObject o where o.id in :ids").setParameter("ids", rows).executeUpdate()
        }
        vault.deleteQuietly(rows)
        val known = tx.execute { em.createQuery("select o.id from StoredObject o", UUID::class.java).resultList.toHashSet() }!!
        val orphans = store.list().filter { it.lastModified.isBefore(cutoff) && it.key.toUuidOrNull()?.let { id -> id !in known } == true }
        vault.deleteQuietly(orphans.map { UUID.fromString(it.key) })
        return SweepResult(orphans.size, rows.size)
    }

    /** A file attached to a Reply that was never sent (Story 7.3). `created_at` is encrypted, so the age is checked in memory. */
    private fun dropUnsentAttachments(cutoff: Instant) = tx.executeWithoutResult {
        em.createQuery("select a from Attachment a where a.messageId is null", Attachment::class.java).resultList
            .filter { it.createdAt.isBefore(cutoff) }.forEach(em::remove)
    }

    /** Rows older than [cutoff] that no Photo or avatar points at. Rows without a created_at (older than Story 4.1) are skipped. */
    private fun unreferencedRows(cutoff: Instant): List<UUID> = tx.execute {
        em.createQuery(
            "select o from StoredObject o where o.id not in (select p.originalObjectId from Photo p) " +
                "and o.id not in (select p.thumbObjectId from Photo p) " +
                "and o.id not in (select a.objectId from Attachment a) " +
                "and o.id not in (select u.avatarObjectId from AppUser u where u.avatarObjectId is not null)",
            StoredObject::class.java,
        ).resultList.filter { it.createdAt?.isBefore(cutoff) == true }.map { it.id }
    }!!

    private fun String.toUuidOrNull(): UUID? = runCatching { UUID.fromString(this) }.getOrNull()

    companion object { val GRACE: Duration = Duration.ofHours(24) }
}
