package co.klei.app.upload

import co.klei.app.taxonomy.TaxonomyService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

class TagEdit {
    var type: String? = null
    var value: String? = null
}

/** Body of `PATCH /uploads/{id}/groups/{gid}`: a field that is missing stays as it is; [attributes] replaces every tag of the Group. */
class GroupEdit {
    var name: String? = null
    var attributes: List<TagEdit>? = null
    var description: String? = null
}

/** A [GroupEdit] after validation: text trimmed, tags in the Taxonomy's spelling and order. A null field was not sent. */
class Checked(val name: String?, val tags: List<Tag>?, val description: String?)

/** Review edits of one Group (FR-10). Tags come from the Taxonomy only; the studio's list decides, not the typed text. */
@Service
class UploadGroupService(private val em: EntityManager, private val batches: UploadBatchService, private val taxonomy: TaxonomyService) {
    @Transactional
    fun edit(userId: UUID, batchId: UUID, groupId: UUID, edit: GroupEdit, ifMatch: Long): GroupView {
        val batch = batches.owned(userId, batchId)
        val g = em.find(UploadGroup::class.java, groupId)?.takeIf { it.batchId == batchId } ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (batch.phase != BatchPhase.REVIEW || g.version != ifMatch) throw ProblemException(ProblemCode.CONFLICT)
        val c = check(edit)
        c.name?.let { g.name = it }
        c.tags?.let { g.attributes = Tags(1, it) }
        c.description?.let { g.description = it }
        em.flush()
        val photos = batches.photos(batchId).filter { it.groupId == g.id }.sortedBy { it.createdAt }.map { it.id }
        return groupView(g, photos)
    }

    fun check(edit: GroupEdit): Checked {
        val problems = mutableListOf<FieldProblem>()
        val name = edit.name?.trim()
        if (name != null && name.isEmpty()) problems += FieldProblem("name", "required")
        if (name != null && name.length > TaxonomyMapper.MAX_NAME) problems += FieldProblem("name", "too_long")
        val description = edit.description?.trim()
        if (description != null && description.length > MAX_DESCRIPTION) problems += FieldProblem("description", "too_long")
        val tags = edit.attributes?.let { requested ->
            val allowed = taxonomy.view().groups.flatMap { grp -> grp.values.map { Tag(grp.type, it.value) } }
            val wanted = requested.map { it.type to it.value }.toSet()
            if (!allowed.map { it.type to it.value }.containsAll(wanted)) problems += FieldProblem("attributes", "invalid")
            allowed.filter { (it.type to it.value) in wanted }
        }
        if (problems.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, problems)
        return Checked(name, tags, description)
    }
}
