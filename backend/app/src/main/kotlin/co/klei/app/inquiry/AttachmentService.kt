package co.klei.app.inquiry

import co.klei.app.upload.ObjectVault
import co.klei.app.upload.StoredObject
import co.klei.app.upload.UploadBatchService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.HexFormat
import java.util.UUID

class AttachmentView(val id: UUID, val name: String, val size: Long)

object ReplyLimits {
    const val MAX_FILES = 10
    const val MAX_BYTES = 20L * 1024 * 1024
    const val MAX_DRAFT = 100_000
    const val MAX_NAME = 255
}

/**
 * FR-21: files for the next Reply. Each is sealed in the bucket like a photo; the file name and size are encrypted columns.
 * A file belongs to one User and one Inquiry until the Reply that carries it is sent; unsent ones are swept after 24 hours.
 * shortcut: any file type, no virus scan; add one if replies ever go out to people outside the studio's own Clients.
 */
@Service
class AttachmentService(
    private val em: EntityManager,
    txm: PlatformTransactionManager,
    private val vault: ObjectVault,
    private val bidx: BlindIndex,
    private val batches: UploadBatchService,
) {
    private val tx = TransactionTemplate(txm)

    /** [source] is read only after the cheap checks pass. A repeated [key] answers with the first file. */
    fun add(inquiryId: UUID, userId: UUID, key: ByteArray, filename: String?, declared: Long, source: () -> ByteArray): AttachmentView {
        val idem = bidx.of(BidxDomain.IDEM, "attach|$userId|${HexFormat.of().formatHex(key)}")
        tx.execute { existing(idem) ?: run { check(inquiryId, userId, declared); null } }?.let { return it }
        val bytes = source()
        if (bytes.isEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("file", "required")))
        val stored = vault.put(bytes)
        try {
            val (view, inserted) = tx.execute { insert(inquiryId, userId, idem, filename, bytes.size.toLong(), stored) }!!
            if (!inserted) vault.deleteQuietly(listOf(stored.id))
            return view
        } catch (e: Exception) {
            vault.deleteQuietly(listOf(stored.id))
            // A parallel call with the same key won the unique index: its file is the answer.
            if (e is DataIntegrityViolationException) tx.execute { existing(idem) }?.let { return it }
            throw e
        }
    }

    private fun existing(idem: ByteArray): AttachmentView? =
        em.createQuery("select a from Attachment a where a.idemBidx = :i", Attachment::class.java).setParameter("i", idem).resultList.firstOrNull()?.let(::view)

    private fun check(inquiryId: UUID, userId: UUID, extra: Long) {
        em.find(Inquiry::class.java, inquiryId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val mine = unsentRows(inquiryId, userId)
        if (mine.size >= ReplyLimits.MAX_FILES || mine.sumOf { it.size } + extra > ReplyLimits.MAX_BYTES) throw ProblemException(ProblemCode.TOO_LARGE)
    }

    private fun insert(inquiryId: UUID, userId: UUID, idem: ByteArray, filename: String?, size: Long, k: co.klei.app.upload.StoredKey): Pair<AttachmentView, Boolean> {
        // The Inquiry row lock serialises two uploads of one User so the limits cannot both pass.
        em.find(Inquiry::class.java, inquiryId, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        existing(idem)?.let { return it to false }
        check(inquiryId, userId, size)
        val now = Instant.now()
        em.persist(StoredObject(k.id, k.wrappedDek, k.kekVersion, now))
        em.flush()
        val a = Attachment(UUID.randomUUID(), inquiryId, userId, k.id, idem, cleanName(filename), size, now)
        em.persist(a)
        em.flush()
        return view(a) to true
    }

    @org.springframework.transaction.annotation.Transactional(readOnly = true)
    fun unsent(inquiryId: UUID, userId: UUID): List<AttachmentView> = unsentRows(inquiryId, userId).map(::view)

    internal fun unsentRows(inquiryId: UUID, userId: UUID): List<Attachment> =
        em.createQuery("select a from Attachment a where a.inquiryId = :i and a.userId = :u and a.messageId is null", Attachment::class.java)
            .setParameter("i", inquiryId).setParameter("u", userId).resultList.sortedBy { it.createdAt }

    /** Removes one unsent file of this User. */
    @org.springframework.transaction.annotation.Transactional
    fun remove(inquiryId: UUID, userId: UUID, id: UUID) {
        val a = em.find(Attachment::class.java, id)?.takeIf { it.inquiryId == inquiryId && it.userId == userId && it.messageId == null }
            ?: throw ProblemException(ProblemCode.NOT_FOUND)
        drop(listOf(a))
    }

    /** Called by Discard: the unsent files go with the draft text. */
    @org.springframework.transaction.annotation.Transactional
    fun discardUnsent(inquiryId: UUID, userId: UUID) = drop(unsentRows(inquiryId, userId))

    private fun drop(rows: List<Attachment>) {
        if (rows.isEmpty()) return
        rows.forEach(em::remove)
        em.flush()
        val ids = rows.map { it.objectId }
        em.createQuery("delete from StoredObject o where o.id in :ids").setParameter("ids", ids).executeUpdate()
        batches.deleteAfterCommit(ids)
    }

    private fun view(a: Attachment) = AttachmentView(a.id, a.name, a.size)

    companion object {
        /** A display name only: no path, no control characters, at most 255 characters. */
        fun cleanName(raw: String?): String =
            raw.orEmpty().substringAfterLast('/').substringAfterLast('\\').filter { !it.isISOControl() }.trim()
                .takeLast(ReplyLimits.MAX_NAME).ifEmpty { "attachment" }
    }
}
