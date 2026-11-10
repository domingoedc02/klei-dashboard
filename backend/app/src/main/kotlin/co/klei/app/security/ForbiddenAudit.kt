package co.klei.app.security

import co.klei.core.audit.AuditAction
import co.klei.app.identity.AppUser
import co.klei.app.identity.AuditService
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** A refused request must leave its Audit Entry even though the request itself fails, so it commits on its own (AD-21). */
@Service
class ForbiddenAudit(private val audit: AuditService, private val em: EntityManager) {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    fun record(caller: Caller, route: String, ip: String) {
        val name = em.find(AppUser::class.java, caller.id)?.name ?: "unknown"
        audit.record(AuditAction.FORBIDDEN, route, caller.id, name, ip)
    }
}
