package co.klei.app.upload

import co.klei.app.ai.AiSettingService
import co.klei.app.taxonomy.TaxonomyService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.ai.AiCall
import co.klei.core.ai.AiFailure
import co.klei.core.ai.AiProviderException
import co.klei.core.ai.AiProviderPort
import co.klei.core.ai.DescribeImage
import co.klei.core.ai.AiPurpose
import co.klei.core.notification.NotificationPort
import co.klei.core.notification.NotificationType
import jakarta.annotation.PreDestroy
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** [step] 1 is Reading (embeddings), 2 Grouping, 3 Tagging (one provider call per group), 4 Writing. [error] and [groups] appear only in their phase. */
data class StatusView(
    val id: UUID,
    val phase: String,
    val step: Int?,
    val done: Int?,
    val total: Int?,
    val error: ErrorView?,
    val groups: List<GroupView>?,
)

/** [code] is a fixed string; [lastGood] is when the last Photo or step finished before the stop. */
data class ErrorView(val code: String, val step: Int, val lastGood: Instant?)

/** [band] is `low`, `medium` or `high`. */
data class GroupView(
    val id: UUID,
    val name: String,
    val confidence: Int,
    val band: String,
    val position: Int,
    val photoIds: List<UUID>,
    val tags: List<TagView>,
    val description: String?,
    val version: Long,
)

data class TagView(val type: String, val value: String)

/** The answer to Rewrite: the new description only; tags stay as the Staff member staged them. */
data class Rewritten(val description: String)

class RewriteBody {
    var photoIds: List<UUID>? = null
}

fun groupView(g: UploadGroup, photoIds: List<UUID>) =
    GroupView(g.id, g.name, g.confidence, confidenceBand(g.confidence), g.position, photoIds, g.attributes.items.map { TagView(it.type, it.value) }, g.description, g.version ?: 0)

private class StepFailure(val step: Int, val code: String) : RuntimeException(code, null, false, false)

private class Progress(val step: Int, val done: Int, val total: Int)

/**
 * Embeds every Photo of a Batch, groups them, then names and tags each group (FR-9). Runs on a small bounded pool, so it goes on when the screen
 * closes. Provider calls never run inside a transaction. A failed run leaves the vectors, groups
 * and descriptions it has, so Retry only does what is missing.
 */
@Service
class GroupingService(
    private val em: EntityManager,
    txm: PlatformTransactionManager,
    private val batches: UploadBatchService,
    private val ai: AiProviderPort,
    private val settings: AiSettingService,
    private val notifier: NotificationPort,
    private val taxonomy: TaxonomyService,
) {
    private val log = LoggerFactory.getLogger(GroupingService::class.java)
    private val tx = TransactionTemplate(txm)
    private val readOnly = TransactionTemplate(txm).apply { isReadOnly = true }
    private val progress = ConcurrentHashMap<UUID, Progress>()
    private val pool = ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, ArrayBlockingQueue(16), ThreadFactory { r -> Thread(r, "grouping").apply { isDaemon = true } })

    // Three provider calls at a time across all batches (FR-9).
    private val describePool = Executors.newFixedThreadPool(3) { r -> Thread(r, "describing").apply { isDaemon = true } }

    @PreDestroy
    fun stop() {
        pool.shutdownNow()
        describePool.shutdownNow()
    }

    /** Starts from `empty`, or restarts from `error`. Calling it while processing changes nothing. */
    fun start(userId: UUID, batchId: UUID): StatusView {
        var launch = false
        tx.executeWithoutResult {
            val b = em.find(UploadBatch::class.java, batchId, LockModeType.PESSIMISTIC_WRITE)?.takeIf { it.userId == userId } ?: throw ProblemException(ProblemCode.NOT_FOUND)
            when (b.phase) {
                BatchPhase.PROCESSING -> Unit
                BatchPhase.REVIEW -> throw ProblemException(ProblemCode.CONFLICT)
                else -> {
                    if (photoCount(batchId) == 0L) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("photos", "required")))
                    b.phase = BatchPhase.PROCESSING
                    b.error = null
                    launch = true
                }
            }
        }
        if (launch) {
            try {
                pool.execute { run(userId, batchId) }
            } catch (e: RejectedExecutionException) {
                fail(batchId, 1, "busy", null)
                throw ProblemException(ProblemCode.UNAVAILABLE)
            }
        }
        return status(userId, batchId)
    }

    fun status(userId: UUID, batchId: UUID): StatusView = readOnly.execute {
        val b = batches.owned(userId, batchId)
        val phase = b.phase.name.lowercase()
        when (b.phase) {
            BatchPhase.PROCESSING -> {
                val p = progress[batchId] ?: Progress(1, 0, photoCount(batchId).toInt())
                StatusView(b.id, phase, p.step, p.done, p.total, null, null)
            }
            BatchPhase.ERROR -> StatusView(b.id, phase, null, null, null, errorOf(b.error), null)
            BatchPhase.REVIEW -> StatusView(b.id, phase, null, null, null, null, groups(b.id))
            BatchPhase.EMPTY -> StatusView(b.id, phase, null, null, null, null, null)
        }
    }!!

    /** Every batch left `processing` by a stopped process is a stopped run; Retry resumes it. */
    fun markInterrupted() {
        tx.executeWithoutResult {
            em.createQuery("select b from UploadBatch b", UploadBatch::class.java).resultList.filter { it.phase == BatchPhase.PROCESSING }.forEach {
                it.phase = BatchPhase.ERROR
                it.error = "interrupted|1|0"
            }
        }
    }

    private class Run(val userId: UUID, val batchId: UUID, var step: Int = 1, @Volatile var lastGood: Instant? = null)

    private fun run(userId: UUID, batchId: UUID) {
        val run = Run(userId, batchId)
        try {
            val ids = tx.execute { batches.photos(batchId).sortedBy { it.createdAt }.map { it.id } }!!
            if (ids.isEmpty()) throw StepFailure(1, "empty")
            embed(run, ids)
            run.step = 2
            if (!grouped(batchId)) group(run, ids)
            run.step = 3
            describe(run)
            run.step = 4
            progress[batchId] = Progress(4, 0, 1)
            finish(run)
        } catch (e: StepFailure) {
            fail(batchId, e.step, e.code, run.lastGood)
        } catch (e: Exception) {
            log.error("grouping failed {}", e.javaClass.name)
            fail(batchId, run.step, "internal", run.lastGood)
        } finally {
            progress.remove(batchId)
        }
    }

    private fun embed(run: Run, ids: List<UUID>) {
        val have = tx.execute {
            em.createQuery("select e.photoId from Embedding e where e.photoId in :ids", UUID::class.java).setParameter("ids", ids).resultList.toSet()
        }!!
        var done = have.size
        progress[run.batchId] = Progress(1, done, ids.size)
        for (id in ids) {
            if (id in have) continue
            val (bytes, mime) = readOnly.execute { batches.image(run.userId, run.batchId, id, false) }!!
            val vector = provider(1) {
                ai.embed(AiCall(AiPurpose.EMBED, run.userId, "image $id"), bytes, mime).also { if (it.isEmpty()) throw AiProviderException(AiFailure.BAD_RESPONSE) }
            }
            val model = settings.config().embeddingModel
            tx.executeWithoutResult { em.persist(Embedding(UUID.randomUUID(), id, Vector(1, vector.toList()), model, vector.size)) }
            run.lastGood = Instant.now()
            progress[run.batchId] = Progress(1, ++done, ids.size)
        }
    }

    /** One retry per provider call (FR-9). */
    private fun <T> provider(step: Int, call: () -> T): T {
        var attempt = 0
        while (true) {
            try {
                return call()
            } catch (e: AiProviderException) {
                // The adapter already retried what it marks `retry`; a missing key or a rejected key would fail again.
                if (e.retry || e.failure in NO_RETRY || attempt++ == 1) throw StepFailure(step, e.failure.name.lowercase())
            }
        }
    }

    private fun grouped(batchId: UUID): Boolean = tx.execute {
        em.createQuery("select count(p) from Photo p where p.batchId = :b and p.groupId is null", Long::class.javaObjectType).setParameter("b", batchId).singleResult == 0L
    }!!

    /**
     * Clusters, has the vision model check each group of two or more photos, then writes the groups in one transaction; the Batch
     * stays `processing` until every group is described. The provider is called between two transactions, never inside one (AD-12).
     */
    private fun group(run: Run, ids: List<UUID>) {
        progress[run.batchId] = Progress(2, 0, ids.size)
        val threshold = Clusterer.threshold(settings.view().sensitivity)
        val vectors = readOnly.execute {
            val byPhoto = em.createQuery("select e from Embedding e where e.photoId in :ids", Embedding::class.java)
                .setParameter("ids", ids).resultList.associateBy { it.photoId }
            ids.map { (byPhoto[it] ?: throw IllegalStateException("missing embedding")).vector.values.toFloatArray() }
        }!!
        val clusters = verify(run, ids, vectors, Clusterer.cluster(vectors, threshold))
        tx.executeWithoutResult {
            val batch = em.find(UploadBatch::class.java, run.batchId, LockModeType.PESSIMISTIC_WRITE) ?: throw IllegalStateException("batch gone")
            em.createQuery("delete from UploadGroup g where g.batchId = :b").setParameter("b", run.batchId).executeUpdate()
            clusters.forEachIndexed { i, c ->
                val g = UploadGroup(UUID.randomUUID(), run.batchId, "Group ${i + 1}", c.confidence, i)
                em.persist(g)
                em.createQuery("update Photo p set p.groupId = :g where p.id in :ids")
                    .setParameter("g", g.id).setParameter("ids", c.members.map { ids[it] }).executeUpdate()
            }
            batch.error = null
        }
    }

    /** One call per group of two or more photos, one after another; a group the model splits becomes several (Story 10.3). */
    private fun verify(run: Run, ids: List<UUID>, vectors: List<FloatArray>, clusters: List<Cluster>): List<Cluster> {
        val sim = Clusterer.similarities(vectors)
        var done = 0
        return clusters.flatMap { c ->
            verifyOne(run, ids, sim, c).also {
                done += c.members.size
                progress[run.batchId] = Progress(2, done, ids.size)
            }
        }.sortedBy { it.members.first() }
    }

    /** A provider failure leaves the group whole but unverified, so it cannot read High; it never fails the batch. Anything else is a bug and does. */
    private fun verifyOne(run: Run, ids: List<UUID>, sim: Array<DoubleArray>, c: Cluster): List<Cluster> {
        if (c.members.size < 2) return listOf(c)
        val sent = GroupVerify.pick(c.members, sim)
        val parts = try {
            val images = sent.map { i -> readOnly.execute { batches.image(run.userId, run.batchId, ids[i], false) }!!.let { (bytes, mime) -> DescribeImage(bytes, mime) } }
            ai.compare(AiCall(AiPurpose.VERIFY, run.userId, "verify ${sent.size} of ${c.members.size} photos"), images)
        } catch (e: AiProviderException) {
            return listOf(Cluster(c.members, minOf(c.confidence, GroupVerify.UNVERIFIED_CAP)))
        }
        if (parts.size == 1) return listOf(c)
        return GroupVerify.split(c.members, sent, parts, sim).map { Cluster(it, Clusterer.confidence(it, sim)) }
    }

    private class Todo(val groupId: UUID, val photos: List<UUID>)

    /** Names, tags and describes each group not yet described; a failed group stops the rest and keeps the finished ones. */
    private fun describe(run: Run) {
        val allowed = allowedTags()
        val tone = settings.view().tone
        var total = 0
        val todo = tx.execute {
            val photos = batches.photos(run.batchId).sortedBy { it.createdAt }.groupBy { it.groupId }
            val groups = em.createQuery("select g from UploadGroup g where g.batchId = :b", UploadGroup::class.java).setParameter("b", run.batchId).resultList
            total = groups.size
            groups.filter { it.description == null }.sortedBy { it.position }.map { Todo(it.id, photos[it.id].orEmpty().take(PER_GROUP).map { p -> p.id }) }
        }!!
        val done = AtomicInteger(total - todo.size)
        progress[run.batchId] = Progress(3, done.get(), total)
        val stop = AtomicBoolean(false)
        val failure = AtomicReference<StepFailure>()
        todo.map { t ->
            describePool.submit(Runnable {
                if (stop.get()) return@Runnable
                try {
                    describeOne(run, t, allowed, tone)
                    run.lastGood = Instant.now()
                    progress[run.batchId] = Progress(3, done.incrementAndGet(), total)
                } catch (e: StepFailure) {
                    failure.compareAndSet(null, e)
                    stop.set(true)
                } catch (e: Exception) {
                    log.error("describing failed {}", e.javaClass.name)
                    failure.compareAndSet(null, StepFailure(3, "internal"))
                    stop.set(true)
                }
            })
        }.forEach { it.get() }
        failure.get()?.let { throw it }
    }

    private fun allowedTags() = taxonomy.view().groups.filter { it.values.isNotEmpty() }.associate { it.type to it.values.map { v -> v.value } }

    private fun thumbs(userId: UUID, batchId: UUID, ids: List<UUID>) =
        ids.map { id -> readOnly.execute { batches.image(userId, batchId, id, false) }!!.let { (bytes, mime) -> DescribeImage(bytes, mime) } }

    /**
     * Rewrite (Story 11.6): one DESCRIBE call for the [photoIds] the screen currently shows in a Group, outside any transaction.
     * Nothing is stored; the Staff member keeps or drops the text and Confirm and save writes it. [groupId] only labels the usage row.
     */
    fun rewrite(userId: UUID, batchId: UUID, groupId: UUID, photoIds: List<UUID>): Rewritten {
        val ids = photoIds.distinct().take(PER_GROUP)
        if (ids.isEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("photoIds", "required")))
        readOnly.executeWithoutResult {
            if (batches.owned(userId, batchId).phase != BatchPhase.REVIEW) throw ProblemException(ProblemCode.CONFLICT)
            ids.forEach { if (batches.photoOf(batchId, it).state != null) throw ProblemException(ProblemCode.NOT_FOUND) }
        }
        val images = thumbs(userId, batchId, ids)
        val answer = try {
            ai.describe(AiCall(AiPurpose.DESCRIBE, userId, "group $groupId"), images, allowedTags(), settings.view().tone)
        } catch (e: AiProviderException) {
            throw ProblemException(ProblemCode.AI_PROVIDER_FAILED)
        }
        return Rewritten(answer.description.trim().take(MAX_DESCRIPTION))
    }

    private fun describeOne(run: Run, t: Todo, allowed: Map<String, List<String>>, tone: String) {
        val images = thumbs(run.userId, run.batchId, t.photos)
        val answer = provider(3) { ai.describe(AiCall(AiPurpose.DESCRIBE, run.userId, "group ${t.groupId}"), images, allowed, tone) }
        val tags = TaxonomyMapper.map(answer.attributes, allowed)
        val named = TaxonomyMapper.named(answer.attributes)
        tx.executeWithoutResult {
            val g = em.find(UploadGroup::class.java, t.groupId) ?: return@executeWithoutResult
            g.name = TaxonomyMapper.name(answer.name, g.name)
            g.attributes = Tags(1, tags)
            g.description = answer.description.trim().take(MAX_DESCRIPTION)
            g.confidence = ConfidenceScorer.score(g.confidence, tags.size, named)
        }
    }

    /** Moves the Batch to `review` and raises the Notification, once, after the last group. */
    private fun finish(run: Run) {
        tx.executeWithoutResult {
            val batch = em.find(UploadBatch::class.java, run.batchId, LockModeType.PESSIMISTIC_WRITE) ?: throw IllegalStateException("batch gone")
            val gowns = em.createQuery("select count(g) from UploadGroup g where g.batchId = :b", Long::class.javaObjectType).setParameter("b", run.batchId).singleResult
            batch.phase = BatchPhase.REVIEW
            batch.error = null
            notifier.notify(NotificationType.AI_FINISHED, listOf(run.userId), "AI finished grouping ${photoCount(run.batchId)} images into $gowns gowns", "upload")
        }
    }

    private fun fail(batchId: UUID, step: Int, code: String, lastGood: Instant?) {
        try {
            tx.executeWithoutResult {
                em.find(UploadBatch::class.java, batchId, LockModeType.PESSIMISTIC_WRITE)?.let {
                    it.phase = BatchPhase.ERROR
                    it.error = "$code|$step|${lastGood?.toEpochMilli() ?: 0}"
                }
            }
        } catch (e: Exception) {
            log.error("grouping state not saved {}", e.javaClass.name)
        }
    }

    private fun errorOf(raw: String?): ErrorView? {
        val p = raw?.split('|') ?: return null
        return ErrorView(p[0], p.getOrNull(1)?.toIntOrNull() ?: 1, p.getOrNull(2)?.toLongOrNull()?.takeIf { it > 0 }?.let(Instant::ofEpochMilli))
    }

    /** Low confidence first, so the groups that need a look lead the review; position keeps the order inside a band. */
    fun groups(batchId: UUID): List<GroupView> {
        val photos = batches.livePhotos(batchId).sortedBy { it.createdAt }.groupBy { it.groupId }
        return em.createQuery("select g from UploadGroup g where g.batchId = :b", UploadGroup::class.java).setParameter("b", batchId).resultList
            .map { groupView(it, photos[it.id].orEmpty().map { p -> p.id }) }
            .sortedWith(compareBy({ BANDS.indexOf(it.band) }, { it.position }))
    }

    private fun photoCount(batchId: UUID): Long =
        em.createQuery("select count(p) from Photo p where p.batchId = :b", Long::class.javaObjectType).setParameter("b", batchId).singleResult

    private companion object {
        const val PER_GROUP = 4
        val NO_RETRY = setOf(AiFailure.NOT_CONFIGURED, AiFailure.REFUSED, AiFailure.UNAUTHORIZED)
        val BANDS = listOf("low", "medium", "high")
    }
}
