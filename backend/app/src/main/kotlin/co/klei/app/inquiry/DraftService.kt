package co.klei.app.inquiry

import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

class DraftView(val body: String, val updatedAt: Instant?, val attachments: List<AttachmentView>)
class DraftSaved(val updatedAt: Instant?)

/** FR-21: one unsent Reply per Inquiry per User. The text is stored clean, as the Reply would be. */
@Service
class DraftService(private val em: EntityManager, private val files: AttachmentService) {

    @Transactional(readOnly = true)
    fun get(inquiryId: UUID, userId: UUID): DraftView {
        em.find(Inquiry::class.java, inquiryId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val d = find(inquiryId, userId)
        return DraftView(d?.body.orEmpty(), d?.updatedAt, files.unsent(inquiryId, userId))
    }

    /** A draft with no text is the same as no draft: the row goes and the answer carries no time. */
    @Transactional
    fun put(inquiryId: UUID, userId: UUID, raw: String?): DraftSaved {
        val text = raw.orEmpty()
        if (text.length > ReplyLimits.MAX_DRAFT) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("body", "too_long")))
        // The row lock keeps two autosaves of one User from both inserting.
        em.find(Inquiry::class.java, inquiryId, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val clean = HtmlSanitizer.clean(text)
        val d = find(inquiryId, userId)
        if (HtmlSanitizer.plain(clean).isBlank()) {
            d?.let(em::remove)
            return DraftSaved(null)
        }
        val now = Instant.now()
        if (d == null) em.persist(Draft(UUID.randomUUID(), inquiryId, userId, clean, now)) else { d.body = clean; d.updatedAt = now }
        return DraftSaved(now)
    }

    /** Repeating it, or calling it with no draft, is fine (204 each time). */
    @Transactional
    fun discard(inquiryId: UUID, userId: UUID) {
        em.find(Inquiry::class.java, inquiryId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        find(inquiryId, userId)?.let(em::remove)
        files.discardUnsent(inquiryId, userId)
    }

    private fun find(inquiryId: UUID, userId: UUID): Draft? =
        em.createQuery("select d from Draft d where d.inquiryId = :i and d.userId = :u", Draft::class.java)
            .setParameter("i", inquiryId).setParameter("u", userId).resultList.firstOrNull()
}
