package co.klei.app.identity

import co.klei.app.upload.ImageValidator
import co.klei.app.upload.ObjectVault
import co.klei.app.upload.StoredObject
import co.klei.app.upload.ThumbnailService
import co.klei.app.upload.UploadBatchService
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/**
 * The User's own photo (FR-30): rebuilt from pixels as a 256 px JPEG, so EXIF and trailing bytes never reach the bucket,
 * then sealed like any other object. The old object goes after commit; a failure there is left for the nightly sweep.
 * shortcut: no decode semaphore; a 2 MB file is small next to a 25 MB photo. Add one if avatars ever upload in bulk.
 */
@Service
class AvatarService(
    private val em: EntityManager,
    private val users: UserService,
    private val images: ImageValidator,
    private val thumbs: ThumbnailService,
    private val vault: ObjectVault,
    private val batches: UploadBatchService,
) {
    companion object {
        const val MAX_BYTES = 2L * 1024 * 1024
        const val SIZE = 256
    }

    /** [declared] is the size the client claims; the body is only read when it is within the limit. 413 or 415 refuse a bad file. */
    @Transactional
    fun set(userId: UUID, declared: Long, source: () -> ByteArray) {
        if (declared > MAX_BYTES) throw ProblemException(ProblemCode.TOO_LARGE)
        val bytes = source()
        if (bytes.size > MAX_BYTES) throw ProblemException(ProblemCode.TOO_LARGE)
        val small = thumbs.make(bytes, images.inspect(bytes), SIZE)
        val u = users.get(userId) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        val k = vault.put(small)
        try {
            em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, Instant.now()))
            em.flush()
            val old = u.avatarObjectId
            u.avatarObjectId = k.id
            em.flush()
            old?.let(::drop)
        } catch (e: Exception) {
            vault.deleteQuietly(listOf(k.id))
            throw e
        }
    }

    @Transactional
    fun remove(userId: UUID) {
        val u = users.get(userId) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        val old = u.avatarObjectId ?: return
        u.avatarObjectId = null
        em.flush()
        drop(old)
    }

    @Transactional(readOnly = true)
    fun read(userId: UUID): ByteArray {
        val id = users.get(userId)?.avatarObjectId ?: throw ProblemException(ProblemCode.NOT_FOUND)
        return vault.read(em.find(StoredObject::class.java, id) ?: throw ProblemException(ProblemCode.NOT_FOUND))
    }

    /** A number that changes with every new photo and is null without one; the screen puts it in the image address so a new photo shows at once. */
    @Transactional(readOnly = true)
    fun revision(u: AppUser): Long? =
        u.avatarObjectId?.let { id -> em.find(StoredObject::class.java, id)?.createdAt?.toEpochMilli() ?: 1L }

    private fun drop(id: UUID) {
        em.createQuery("delete from StoredObject o where o.id = :id").setParameter("id", id).executeUpdate()
        batches.deleteAfterCommit(listOf(id))
    }
}
