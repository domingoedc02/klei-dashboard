package co.klei.app.gown

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.taxonomy.TaxonomyValue
import co.klei.app.upload.GroupEdit
import co.klei.app.upload.UploadGroupService
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** FR-16: correct a saved Gown's name, tags and description. Photos are not touched. */
@Service
class GownEditService(
    private val em: EntityManager,
    private val check: UploadGroupService,
    private val terms: TermIndexer,
    private val audit: AuditService,
    private val users: UserService,
) {
    /**
     * A field that is missing stays as it is; `attributes` is the whole tag set; an empty description clears it.
     * 409 on a stale [ifMatch]. The caller reads the Gown again after this commits, so the version it returns is the new one.
     */
    @Transactional
    fun edit(id: UUID, edit: GroupEdit, ifMatch: Long, by: UUID, ip: String?) {
        val g = em.find(Gown::class.java, id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (g.version != ifMatch) throw ProblemException(ProblemCode.CONFLICT)
        val c = check.check(edit)

        val changed = mutableListOf<String>()
        c.name?.takeIf { it != g.name }?.let { g.name = it; changed += "name" }
        c.description?.let { text ->
            val d = text.ifBlank { null }
            if (d != g.description) { g.description = d; changed += "description" }
        }

        var words = "name" in changed
        c.tags?.let { wanted ->
            val values = em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.associateBy { it.id }
            val byTag = values.values.associateBy { it.type.code to it.value }
            val want = wanted.mapNotNull { byTag[it.type to it.value]?.id }.toSet()
            val have = em.createQuery("select a from GownAttribute a where a.gownId = :g", GownAttribute::class.java).setParameter("g", id).resultList
            val drop = have.filter { it.taxonomyValueId !in want }
            val add = want - have.map { it.taxonomyValueId }.toSet()
            if (drop.isNotEmpty() || add.isNotEmpty()) {
                drop.forEach { em.remove(it) }
                em.flush()
                add.forEach { em.persist(GownAttribute(UUID.randomUUID(), id, it)) }
                changed += "tags"
                words = words || (drop.map { it.taxonomyValueId } + add).any { values[it]?.type in TermIndexer.WORD_TYPES }
            }
        }
        if (changed.isEmpty()) return

        // Tags are other rows, so a tags-only edit would leave the Gown's own version where it was; a changed column already bumps it.
        if (changed == listOf("tags")) em.lock(g, LockModeType.OPTIMISTIC_FORCE_INCREMENT)
        em.flush()
        if (words) terms.reindex(listOf(g))
        audit.record(AuditAction.GOWN_EDITED, "fields=${changed.joinToString(",")}", by, users.get(by)?.name ?: "unknown", ip)
    }
}
