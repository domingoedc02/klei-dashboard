package co.klei.app.inquiry

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.security.access.AccessDeniedException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

class StatusChanged(val id: UUID, val status: String, val version: Long)

/** FR-22: set an Inquiry to New, Replied or Closed. Moving into or out of Closed needs `PERM_CLOSE_INQUIRY` (A9). */
@Service
class InquiryStatusService(
    private val em: EntityManager,
    private val state: InquiryStateService,
    private val audit: AuditService,
    private val users: UserService,
) {
    /** A refused close is a plain [AccessDeniedException]: the advice answers 403 and writes the `forbidden` Audit Entry. */
    @Transactional
    fun change(id: UUID, status: String?, ifMatch: Long, canClose: Boolean, userId: UUID, ip: String?): StatusChanged {
        val to = parse(status)
        val i = em.find(Inquiry::class.java, id, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val from = i.status
        if (!canClose && (to == InquiryStatus.CLOSED || from == InquiryStatus.CLOSED)) throw AccessDeniedException("close")
        if (ifMatch != i.version) throw ProblemException(ProblemCode.CONFLICT)
        if (to != from) {
            state.setStatus(i, to)
            audit.record(AuditAction.INQUIRY_STATUS_CHANGED, "${from.name.lowercase()} to ${to.name.lowercase()}", userId, users.get(userId)?.name ?: "unknown", ip)
            em.flush()
        }
        return StatusChanged(i.id, i.status.name.lowercase(), i.version ?: 0)
    }

    private fun parse(s: String?): InquiryStatus {
        if (s.isNullOrEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("status", "required")))
        return InquiryStatus.entries.firstOrNull { it.name.lowercase() == s } ?: throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("status", "invalid")))
    }
}
