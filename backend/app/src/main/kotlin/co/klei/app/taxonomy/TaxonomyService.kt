package co.klei.app.taxonomy

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import co.klei.core.taxonomy.TaxonomyChanged
import co.klei.core.taxonomy.TaxonomyType
import co.klei.core.taxonomy.UsageCounter
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.context.ApplicationEventPublisher
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

data class TaxonomyItem(val id: UUID, val type: String, val value: String, val version: Long)
data class TaxonomyGroup(val type: String, val values: List<TaxonomyItem>)
data class TaxonomyView(val groups: List<TaxonomyGroup>)

/** Body of `PUT /api/v1/taxonomy`: one change per call. `op` is `add` (type, value), `rename` (id, value) or `remove` (id). */
class TaxonomyChange {
    var op: String? = null
    var type: String? = null
    var id: UUID? = null
    var value: String? = null
}

/** The Taxonomy (FR-38). A few dozen rows, so every read decrypts the lot and filters in memory (architecture §4.2). */
@Service
class TaxonomyService(
    private val em: EntityManager,
    private val users: UserService,
    private val audit: AuditService,
    private val usage: UsageCounter,
    private val events: ApplicationEventPublisher,
) {
    @Transactional(readOnly = true)
    fun view(): TaxonomyView = group(load(lock = false))

    /** [ifMatch] is the value's version; `rename` and `remove` need it, `add` ignores it. */
    @Transactional
    fun apply(change: TaxonomyChange, ifMatch: () -> Long, by: UUID, ip: String?): TaxonomyView {
        val actor = users.get(by)?.name ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        val op = change.op
        if (op !in OPS) throw invalid("op", "invalid")
        // shortcut: the row lock does not cover a row another Admin inserts at the same instant, so two identical adds can both land; add a unique blind index if that ever matters.
        val rows = load(lock = true)
        val detail: String
        when (op) {
            "add" -> {
                val type = TaxonomyType.of(change.type) ?: throw invalid("type", "invalid")
                val value = clean(change.value)
                ensureUnique(rows, type, value, null)
                em.persist(TaxonomyValue(UUID.randomUUID(), type, value))
                detail = "added ${type.code}"
            }
            "rename" -> {
                val row = find(rows, change.id)
                if (ifMatch() != row.version) throw ProblemException(ProblemCode.CONFLICT)
                val value = clean(change.value)
                if (value == row.value) return group(rows)
                ensureUnique(rows, row.type, value, row.id)
                row.value = value
                detail = "renamed ${row.type.code}"
                events.publishEvent(TaxonomyChanged(row.type, row.id))
            }
            else -> {
                val row = find(rows, change.id)
                if (ifMatch() != row.version) throw ProblemException(ProblemCode.CONFLICT)
                val n = usage.usedBy(row.id)
                if (n > 0) throw ProblemException(ProblemCode.CONFLICT, extensions = mapOf("usedBy" to n))
                em.remove(row)
                detail = "removed ${row.type.code}"
            }
        }
        em.flush()
        audit.record(AuditAction.TAXONOMY_CHANGED, detail, by, actor, ip)
        return group(load(lock = false))
    }

    private fun load(lock: Boolean): List<TaxonomyValue> =
        em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java)
            .apply { if (lock) setLockMode(LockModeType.PESSIMISTIC_WRITE) }
            .resultList

    private fun group(rows: List<TaxonomyValue>) = TaxonomyView(
        TaxonomyType.entries.map { t ->
            TaxonomyGroup(t.code, rows.filter { it.type == t }.sortedBy { it.value.lowercase() }.map { TaxonomyItem(it.id, t.code, it.value, it.version ?: 0) })
        },
    )

    private fun find(rows: List<TaxonomyValue>, id: UUID?): TaxonomyValue {
        if (id == null) throw invalid("id", "required")
        return rows.firstOrNull { it.id == id } ?: throw ProblemException(ProblemCode.NOT_FOUND)
    }

    private fun clean(raw: String?): String {
        val v = raw?.trim().orEmpty()
        return when {
            v.isEmpty() -> throw invalid("value", "required")
            v.length > MAX_VALUE -> throw invalid("value", "too_long")
            v.any { it < ' ' || it.code == 127 } -> throw invalid("value", "invalid")
            else -> v
        }
    }

    private fun ensureUnique(rows: List<TaxonomyValue>, type: TaxonomyType, value: String, self: UUID?) {
        if (rows.any { it.type == type && it.id != self && it.value.equals(value, ignoreCase = true) }) throw invalid("value", "duplicate")
    }

    private fun invalid(field: String, code: String) = ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem(field, code)))

    companion object {
        val OPS = setOf("add", "rename", "remove")
        const val MAX_VALUE = 60
    }
}
