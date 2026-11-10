package co.klei.app.crypto

import co.klei.app.identity.AuditService
import co.klei.app.identity.RoleService
import co.klei.app.identity.UserService
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import co.klei.core.notification.NotificationPort
import co.klei.core.notification.NotificationType
import co.klei.crypto.CryptoException
import co.klei.crypto.KeyRotation
import jakarta.annotation.PreDestroy
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.util.UUID
import java.util.concurrent.Executors
import javax.sql.DataSource

/** [state] is `idle` (never run here, or nothing to do), `running`, `done` or `failed`. Counts are rows, never ids. */
class RewrapRun(val state: String, val done: Long, val total: Long, val dataKey: Long, val storedObject: Long)

/** Rows per `kek_version`, keys are the version numbers. */
class KeyRows(val dataKey: Map<String, Long>, val storedObject: Map<String, Long>)

class KeyStatus(val active: Int, val highest: Int, val configured: List<Int>, val rows: KeyRows, val run: RewrapRun)

/**
 * FR-41, architecture §5.4 step 3: moves every wrapped DEK from an older KEK to the active one. One run at a time per process;
 * each batch is its own short transaction on a raw connection, so readers never wait and a stopped run resumes by the same predicate.
 * Status and logs carry counts and fixed codes only.
 */
@Service
class RewrapJob(
    private val rotation: KeyRotation,
    private val db: DataSource,
    private val audit: AuditService,
    private val notifier: NotificationPort,
    private val roles: RoleService,
    private val users: UserService,
    private val tx: TransactionTemplate,
) {
    private val log = LoggerFactory.getLogger(RewrapJob::class.java)
    private val lock = Any()
    private var running = false
    private val pool = Executors.newSingleThreadExecutor { Thread(it, "key-rewrap").apply { isDaemon = true } }
    @Volatile private var progress = IDLE

    @PreDestroy fun close() { pool.shutdown() }

    fun status(): KeyStatus = db.connection.use { c ->
        KeyStatus(rotation.activeKek, rotation.highestKek, rotation.configured,
            KeyRows(counts(c, KeyRotation.Table.DATA_KEY), counts(c, KeyRotation.Table.STORED_OBJECT)), progress)
    }

    /** Starts the run on a background thread. A finished-nothing answer (`idle`, zero counts) means there was nothing to re-wrap. */
    fun start(by: UUID, ip: String?): RewrapRun {
        if (rotation.activeKek != rotation.highestKek) throw conflict("active_not_highest")
        synchronized(lock) {
            if (running) throw conflict("in_progress")
            val total = pending()
            if (total == 0L) return IDLE
            running = true
            progress = RewrapRun("running", 0, total, 0, 0)
            try {
                pool.execute { work(by, ip, total) }
            } catch (e: Throwable) {
                running = false
                throw e
            }
            return progress
        }
    }

    /** The state and the single-flight flag change together, so a poller that sees `done` can start again at once. */
    private fun finish(run: RewrapRun) = synchronized(lock) { progress = run; running = false }

    private fun work(by: UUID, ip: String?, total: Long) {
        var data = 0L
        var objs = 0L
        try {
            for (t in KeyRotation.Table.entries) {
                while (true) {
                    val n = batch(t)
                    if (n == 0) break
                    if (t == KeyRotation.Table.DATA_KEY) data += n else objs += n
                    progress = RewrapRun("running", data + objs, total, data, objs)
                }
            }
            tx.execute {
                audit.record(AuditAction.KEY_ROTATION, "dataKey=$data storedObject=$objs kek=${rotation.activeKek}", by, users.get(by)?.name ?: "unknown", ip)
                notifier.notify(NotificationType.TEAM_ACTIVITY, roles.adminIds().filter { it != by }, "Keys re-wrapped to version ${rotation.activeKek}", "settings")
            }
            finish(RewrapRun("done", data + objs, total, data, objs))
        } catch (e: Throwable) {
            log.error("key re-wrap failed: {} {}", e.javaClass.simpleName, (e as? CryptoException)?.code.orEmpty())
            finish(RewrapRun("failed", data + objs, total, data, objs))
        }
    }

    private fun batch(t: KeyRotation.Table): Int = db.connection.use { c ->
        c.autoCommit = false
        try {
            rotation.rewrapBatch(c, t, BATCH).also { c.commit() }
        } catch (e: Throwable) {
            c.rollback()
            throw e
        } finally {
            c.autoCommit = true
        }
    }

    private fun pending(): Long = db.connection.use { c ->
        KeyRotation.Table.entries.sumOf { t -> rotation.status(c, t).filterKeys { it < rotation.activeKek }.values.sum() }
    }

    private fun counts(c: java.sql.Connection, t: KeyRotation.Table): Map<String, Long> =
        rotation.status(c, t).toSortedMap().mapKeys { it.key.toString() }

    private fun conflict(check: String) = ProblemException(ProblemCode.CONFLICT, emptyList(), mapOf("check" to check))

    companion object {
        const val BATCH = 500
        private val IDLE = RewrapRun("idle", 0, 0, 0, 0)
    }
}
