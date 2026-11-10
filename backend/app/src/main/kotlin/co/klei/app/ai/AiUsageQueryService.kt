package co.klei.app.ai

import co.klei.app.identity.AppUser
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

/** One line of the usage list (FR-39). No prompt or response: nothing in the MVP exposes those. */
data class AiUsageRow(
    val id: UUID, val time: Instant, val user: String, val purpose: String, val model: String?, val size: Long?, val outcome: String, val durationMs: Long,
)

/** `page` is 1-based; `pages` is at least 1 so an empty log reads "Page 1 of 1". */
data class AiUsagePage(val items: List<AiUsageRow>, val page: Int, val pages: Int)

/** Read side of `ai_usage`. Newest first by `seq`; columns are decrypted on load, so order and count are the database's. */
@Service
class AiUsageQueryService(private val em: EntityManager) {
    @Transactional(readOnly = true)
    fun page(page: Int): AiUsagePage {
        val total = em.createQuery("select count(u) from AiUsage u", java.lang.Long::class.java).singleResult.toLong()
        val pages = maxOf(1, ((total + SIZE - 1) / SIZE).toInt())
        val rows = em.createQuery("select u from AiUsage u order by u.seq desc", AiUsage::class.java)
            .setFirstResult((page - 1) * SIZE).setMaxResults(SIZE).resultList
        val ids = rows.mapNotNull { it.userId }.distinct()
        val names = if (ids.isEmpty()) emptyMap() else
            em.createQuery("select u from AppUser u where u.id in :ids", AppUser::class.java).setParameter("ids", ids).resultList.associate { it.id to it.name }
        val items = rows.map { r ->
            val who = when { r.userId == null -> SYSTEM; else -> names[r.userId] ?: DELETED }
            AiUsageRow(r.id, r.createdAt, who, r.purpose.name.lowercase(), r.model, r.size, r.outcome.name.lowercase(), r.duration)
        }
        return AiUsagePage(items, page, pages)
    }

    companion object {
        const val SIZE = 50
        const val MAX_PAGE = 1_000_000
        const val SYSTEM = "System"
        const val DELETED = "Deleted user"
    }
}
