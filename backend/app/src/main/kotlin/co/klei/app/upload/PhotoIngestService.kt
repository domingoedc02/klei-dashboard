package co.klei.app.upload

import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

/**
 * One file in, one Photo out (architecture §5.5). Order matters: validate, thumbnail, encrypt, write both objects,
 * then one DB transaction for both `stored_object` rows and the `photo` row. When that transaction fails the
 * objects are deleted again; a crash in between leaves orphans for the nightly sweep. A repeat of the same
 * `Idempotency-Key` returns the first Photo and stores nothing.
 */
@Service
class PhotoIngestService(
    private val em: EntityManager,
    txm: PlatformTransactionManager,
    private val batches: UploadBatchService,
    private val images: ImageValidator,
    private val thumbs: ThumbnailService,
    private val vault: ObjectVault,
) {
    private val tx = TransactionTemplate(txm)
    private val decodes = Semaphore(UploadLimits.MAX_DECODES)

    /** [source] reads the file body; it is only called once a decode slot is held, so memory stays bounded. */
    fun add(userId: UUID, batchId: UUID, idem: ByteArray, filename: String?, declaredSize: Long, source: () -> ByteArray): UUID {
        precheck(userId, batchId, idem)?.let { return it }
        if (declaredSize > UploadLimits.MAX_FILE_BYTES) reject(batchId, ProblemCode.TOO_LARGE)
        if (!decodes.tryAcquire(DECODE_WAIT_SECONDS, TimeUnit.SECONDS)) throw ProblemException(ProblemCode.UNAVAILABLE)
        try {
            val bytes = source()
            if (bytes.size > UploadLimits.MAX_FILE_BYTES) reject(batchId, ProblemCode.TOO_LARGE)
            val info = try { images.inspect(bytes) } catch (e: ProblemException) { reject(batchId, e.problem) }
            val thumb = try { thumbs.make(bytes, info) } catch (e: ProblemException) { reject(batchId, e.problem) }
            val original = vault.put(bytes)
            val small = try { vault.put(thumb) } catch (e: Exception) { vault.deleteQuietly(listOf(original.id)); throw e }
            val ids = listOf(original.id, small.id)
            try {
                val (id, inserted) = insert(userId, batchId, idem, filename, info.type, bytes.size.toLong(), original, small)
                if (!inserted) vault.deleteQuietly(ids)
                return id
            } catch (e: ProblemException) {
                vault.deleteQuietly(ids)
                if (e.problem == ProblemCode.TOO_LARGE) reject(batchId, e.problem)
                throw e
            } catch (e: Exception) {
                vault.deleteQuietly(ids)
                // A parallel call with the same key won the unique index: its Photo is the answer.
                precheck(userId, batchId, idem)?.let { return it }
                throw e
            }
        } finally {
            decodes.release()
        }
    }

    /** The first Photo of this key, or null; refuses a full batch before any decoding is spent on it. */
    private fun precheck(userId: UUID, batchId: UUID, idem: ByteArray): UUID? = tx.execute {
        batches.owned(userId, batchId)
        val first = existing(batchId, idem)
        if (first == null && count(batchId) >= UploadLimits.MAX_PHOTOS) throw ProblemException(ProblemCode.TOO_LARGE)
        first?.id
    }

    private fun reject(batchId: UUID, problem: ProblemCode): Nothing {
        batches.countRejected(batchId)
        throw ProblemException(problem)
    }

    private fun insert(
        userId: UUID, batchId: UUID, idem: ByteArray, filename: String?, type: ImageType, size: Long, original: StoredKey, thumb: StoredKey,
    ): Pair<UUID, Boolean> = tx.execute {
        val batch = em.find(UploadBatch::class.java, batchId, LockModeType.PESSIMISTIC_WRITE)?.takeIf { it.userId == userId } ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (batch.phase == BatchPhase.PROCESSING) throw ProblemException(ProblemCode.CONFLICT)
        existing(batchId, idem)?.let { return@execute it.id to false }
        if (count(batchId) >= UploadLimits.MAX_PHOTOS) throw ProblemException(ProblemCode.TOO_LARGE)
        val now = Instant.now()
        for (k in listOf(original, thumb)) em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, now))
        em.flush()
        val photo = Photo(UUID.randomUUID(), batchId, original.id, thumb.id, idem, cleanName(filename), type.mime, size, now)
        em.persist(photo)
        em.flush()
        photo.id to true
    }!!

    private fun existing(batchId: UUID, idem: ByteArray): Photo? =
        em.createQuery("select p from Photo p where p.batchId = :b and p.idemBidx = :i", Photo::class.java)
            .setParameter("b", batchId).setParameter("i", idem).resultList.firstOrNull()

    private fun count(batchId: UUID): Long =
        em.createQuery("select count(p) from Photo p where p.batchId = :b", Long::class.javaObjectType).setParameter("b", batchId).singleResult

    private fun cleanName(raw: String?): String = raw?.filter { it >= ' ' && it != '\u007f' }?.trim()?.takeLast(255)?.ifEmpty { null } ?: "image"

    private companion object { const val DECODE_WAIT_SECONDS = 60L }
}
