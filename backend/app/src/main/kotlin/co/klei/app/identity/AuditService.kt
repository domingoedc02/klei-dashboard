package co.klei.app.identity

import co.klei.core.audit.AuditAction
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** The single writer of `audit_entry` (AD-21). Joins the caller's transaction, so a rolled-back action leaves no entry. */
@Service
class AuditService(private val em: EntityManager) {
    @Transactional
    fun record(action: String, detail: String? = null, actorId: UUID? = null, actorName: String = "system", ip: String? = null) {
        em.persist(AuditEntry(UUID.randomUUID(), Instant.now(), actorId?.toString(), actorName, action, detail, ip))
    }

    @Transactional
    fun record(action: AuditAction, detail: String? = null, actorId: UUID? = null, actorName: String = "system", ip: String? = null) =
        record(action.code, detail, actorId, actorName, ip)

    /** Tests only: the whole table in memory. The screen reads through `AuditQueryService`. */
    @Transactional(readOnly = true)
    fun all(): List<AuditEntry> = em.createQuery("select a from AuditEntry a", AuditEntry::class.java).resultList
}
