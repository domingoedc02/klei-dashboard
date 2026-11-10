package co.klei.app.identity

import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

data class AuditRow(val id: UUID, val ts: Instant, val actor: String, val action: String, val detail: String?, val ip: String?)

/** `page` is 1-based; `pages` is at least 1 so an empty log reads "Page 1 of 1". */
data class AuditPage(val items: List<AuditRow>, val page: Int, val pages: Int)

/** Read side of the Audit log (FR-40). Newest first by `seq`; the columns are decrypted on load, so order and count are the database's. */
@Service
class AuditQueryService(private val em: EntityManager) {
    @Transactional(readOnly = true)
    fun page(page: Int): AuditPage {
        val total = em.createQuery("select count(a) from AuditEntry a", java.lang.Long::class.java).singleResult.toLong()
        val pages = maxOf(1, ((total + SIZE - 1) / SIZE).toInt())
        val rows = em.createQuery("select a from AuditEntry a order by a.seq desc", AuditEntry::class.java)
            .setFirstResult((page - 1) * SIZE).setMaxResults(SIZE).resultList
            .map { r -> AuditRow(r.id, r.ts, r.actorName, r.action, r.detail, r.ip) }
        return AuditPage(rows, page, pages)
    }

    companion object {
        const val SIZE = 50
        const val MAX_PAGE = 1_000_000
    }
}
