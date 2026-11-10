package co.klei.app.gown

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.upload.BatchPhase
import co.klei.app.upload.GroupingService
import co.klei.app.upload.Photo
import co.klei.app.upload.StoredObject
import co.klei.app.upload.TagView
import co.klei.app.upload.UploadBatchService
import co.klei.app.taxonomy.TaxonomyValue
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.DayBucket
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** `{saved: n}`: the answer to Save, and to a repeated Save. */
data class Saved(val saved: Int)

/** FR-12: Save turns each named Group into a Gown in one transaction; Discard batch removes everything. */
@Service
class SaveBatchService(
    private val em: EntityManager,
    private val batches: UploadBatchService,
    private val grouping: GroupingService,
    private val terms: TermIndexer,
    private val bidx: BlindIndex,
    private val audit: AuditService,
    private val users: UserService,
) {
    /** A second Save finds the batch gone; the Gowns it made carry the batch's key, so the first answer is replayed. */
    fun replay(userId: UUID, batchId: UUID): Saved? =
        savedBy(userId, bidx.of(BidxDomain.IDEM, "save|$batchId")).takeIf { it > 0 }?.let(::Saved)

    @Transactional
    fun save(userId: UUID, batchId: UUID, ip: String?): Saved {
        replay(userId, batchId)?.let { return it }
        val key = bidx.of(BidxDomain.IDEM, "save|$batchId")
        val batch = batches.owned(userId, batchId)
        if (batch.phase != BatchPhase.REVIEW) throw ProblemException(ProblemCode.CONFLICT)

        val groups = grouping.groups(batchId).filter { it.photoIds.isNotEmpty() }
        if (groups.isEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("groups", "required")))
        val values = em.createQuery("select v from TaxonomyValue v", TaxonomyValue::class.java).resultList.associate { (it.type.code to it.value) to it.id }
        val problems = mutableListOf<FieldProblem>()
        val tagIds = groups.mapIndexed { i, g ->
            if (g.name.isBlank()) problems += FieldProblem("groups[$i].name", "required")
            val ids = g.tags.map { values[it.type to it.value] }
            if (ids.any { it == null }) problems += FieldProblem("groups[$i].attributes", "invalid")
            ids.filterNotNull().distinct()
        }
        if (problems.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, problems.distinct())

        val photos = batches.photos(batchId)
        // Exactly one Gown is New: the one with the highest seq. The previous one is the top row before this Save adds its own.
        em.createQuery("select g from Gown g order by g.seq desc", Gown::class.java).setMaxResults(1).resultList.firstOrNull()?.isNew = false

        val now = Instant.now()
        val day = bidx.of(BidxDomain.GOWN_DAY, DayBucket.of(now))
        groups.forEachIndexed { i, g ->
            val gown = Gown(UUID.randomUUID(), g.name.trim(), g.description?.takeIf { it.isNotBlank() }, g.confidence, now, i == groups.lastIndex, userId, day, key)
            em.persist(gown)
            for (t in tagIds[i]) em.persist(GownAttribute(UUID.randomUUID(), gown.id, t))
            terms.index(gown.id, gown.name, g.tags)
            photos.filter { it.state == null && it.groupId == g.id }.forEach { it.gownId = gown.id; it.batchId = null; it.groupId = null }
        }

        val dropped = photos.filter { it.state != null }
        val objectIds = dropped.flatMap { listOf(it.originalObjectId, it.thumbObjectId) }
        em.createQuery("delete from Embedding e where e.photoId in :ids").setParameter("ids", photos.map { it.id }).executeUpdate()
        dropped.forEach { em.remove(it) }
        em.flush()
        if (objectIds.isNotEmpty()) em.createQuery("delete from StoredObject o where o.id in :ids").setParameter("ids", objectIds).executeUpdate()
        em.createQuery("delete from UploadGroup g where g.batchId = :b").setParameter("b", batchId).executeUpdate()
        em.remove(batch)
        em.flush()
        batches.deleteAfterCommit(objectIds)
        audit.record(AuditAction.UPLOAD_SAVED, "gowns=${groups.size} photos=${photos.size - dropped.size}", userId, users.get(userId)?.name ?: "unknown", ip)
        return Saved(groups.size)
    }

    @Transactional
    fun discard(userId: UUID, batchId: UUID, ip: String?) {
        batches.owned(userId, batchId)
        val count = batches.photos(batchId).size
        batches.discard(userId)
        audit.record(AuditAction.UPLOAD_DISCARDED, "photos=$count", userId, users.get(userId)?.name ?: "unknown", ip)
    }

    private fun savedBy(userId: UUID, key: ByteArray): Int =
        em.createQuery("select count(g) from Gown g where g.saveBidx = :k and g.createdById = :u", Long::class.javaObjectType)
            .setParameter("k", key).setParameter("u", userId).singleResult.toInt()
}
