package co.klei.app.upload

import co.klei.app.identity.AppUser
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.storage.ObjectStorePort
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.time.Instant
import java.util.UUID

/** The caller's batch as the API shows it: phase, Photo ids and the rejected-file count, nothing else. */
data class BatchView(val id: UUID, val phase: String, val photoIds: List<UUID>, val rejected: Int)

object UploadLimits {
    const val MAX_FILE_BYTES = 25L * 1024 * 1024
    const val MAX_PHOTOS = 200
    const val MAX_DECODES = 2
}

/** Batch rules (FR-8): one per User, owned by them, discarded with them. */
@Service
class UploadBatchService(private val em: EntityManager, private val store: ObjectStorePort, private val vault: ObjectVault) {
    private val log = LoggerFactory.getLogger(UploadBatchService::class.java)

    /** The caller's batch; created in phase `empty` when there is none. The user row lock makes two parallel calls agree. */
    @Transactional
    fun ensure(userId: UUID): BatchView {
        em.find(AppUser::class.java, userId, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val batch = find(userId) ?: UploadBatch(UUID.randomUUID(), userId, BatchPhase.EMPTY, Instant.now()).also { em.persist(it) }
        return view(batch)
    }

    @Transactional(readOnly = true)
    fun current(userId: UUID): BatchView = view(find(userId) ?: throw ProblemException(ProblemCode.NOT_FOUND))

    /** The caller's batch without its Photos, or null; the Dashboard only needs the phase. */
    @Transactional(readOnly = true)
    fun peek(userId: UUID): UploadBatch? = find(userId)

    /** The batch when [userId] owns [batchId]; anyone else's id is a plain 404. */
    fun owned(userId: UUID, batchId: UUID): UploadBatch =
        em.find(UploadBatch::class.java, batchId)?.takeIf { it.userId == userId } ?: throw ProblemException(ProblemCode.NOT_FOUND)

    /** Removes the User's batch with every Photo and both stored objects of each; the S3 objects go after commit. No batch is a no-op. */
    @Transactional
    fun discard(userId: UUID) {
        val batch = find(userId) ?: return
        val photos = photos(batch.id)
        val objectIds = photos.flatMap { listOf(it.originalObjectId, it.thumbObjectId) }
        em.createQuery("delete from Photo p where p.batchId = :b").setParameter("b", batch.id).executeUpdate()
        if (objectIds.isNotEmpty()) em.createQuery("delete from StoredObject o where o.id in :ids").setParameter("ids", objectIds).executeUpdate()
        em.remove(batch)
        em.flush()
        deleteAfterCommit(objectIds)
    }

    /** One more refused file for the batch's review screen. The row lock keeps parallel rejections from losing counts. */
    @Transactional
    fun countRejected(batchId: UUID) {
        em.find(UploadBatch::class.java, batchId, LockModeType.PESSIMISTIC_WRITE)?.let { it.rejected += 1 }
    }

    /** Removes one Photo and its two objects. Another User's batch or an unknown Photo is a plain 404. */
    @Transactional
    fun deletePhoto(userId: UUID, batchId: UUID, photoId: UUID) {
        if (owned(userId, batchId).phase == BatchPhase.PROCESSING) throw ProblemException(ProblemCode.CONFLICT)
        val photo = photoOf(batchId, photoId)
        em.remove(photo)
        em.flush()
        val ids = listOf(photo.originalObjectId, photo.thumbObjectId)
        em.createQuery("delete from StoredObject o where o.id in :ids").setParameter("ids", ids).executeUpdate()
        deleteAfterCommit(ids)
    }

    /** Decrypted bytes and their Content-Type: a thumbnail is always a JPEG, an original keeps the sniffed type. */
    fun image(userId: UUID, batchId: UUID, photoId: UUID, full: Boolean): Pair<ByteArray, String> {
        owned(userId, batchId)
        val photo = photoOf(batchId, photoId)
        val objectId = if (full) photo.originalObjectId else photo.thumbObjectId
        val obj = em.find(StoredObject::class.java, objectId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        return vault.read(obj) to (if (full) photo.contentType else ImageType.JPEG.mime)
    }

    fun photoOf(batchId: UUID, photoId: UUID): Photo =
        em.find(Photo::class.java, photoId)?.takeIf { it.batchId == batchId } ?: throw ProblemException(ProblemCode.NOT_FOUND)

    fun photos(batchId: UUID): List<Photo> =
        em.createQuery("select p from Photo p where p.batchId = :b", Photo::class.java).setParameter("b", batchId).resultList

    /** The Photos the screen shows: those not discarded in review. */
    fun livePhotos(batchId: UUID): List<Photo> = photos(batchId).filter { it.state == null }

    /** Object deletes run once the rows are gone. A failure is left for the nightly sweep. */
    fun deleteAfterCommit(ids: List<UUID>) {
        if (ids.isEmpty()) return
        TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
            override fun afterCommit() {
                for (id in ids) runCatching { store.delete(id) }.onFailure { log.warn("object delete failed, left for the sweep: {}", it.javaClass.name) }
            }
        })
    }

    private fun find(userId: UUID): UploadBatch? =
        em.createQuery("select b from UploadBatch b where b.userId = :u", UploadBatch::class.java).setParameter("u", userId).resultList.firstOrNull()

    private fun view(b: UploadBatch) = BatchView(b.id, b.phase.name.lowercase(), livePhotos(b.id).sortedBy { it.createdAt }.map { it.id }, b.rejected)
}
