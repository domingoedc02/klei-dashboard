package co.klei.app.gown

import co.klei.app.upload.BatchPhase
import co.klei.app.upload.GroupEdit
import co.klei.app.upload.PhotoState
import co.klei.app.upload.RearrangeService
import co.klei.app.upload.Tags
import co.klei.app.upload.TagEdit
import co.klei.app.upload.UploadBatchService
import co.klei.app.upload.UploadGroup
import co.klei.app.upload.UploadGroupService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** A Group the screen loaded and then removed (merged away or emptied). */
class GroupRef {
    var id: UUID? = null
    var version: Long? = null
}

/** One Group as the Staff member left it. [version] is the one the screen loaded; a Group made on the screen has none. */
class CommitGroup {
    var id: UUID? = null
    var version: Long? = null
    var name: String? = null
    var attributes: List<TagEdit>? = null
    var description: String? = null
    var photoIds: List<UUID>? = null
}

/** The whole review as staged on the screen (Story 11.6): the Groups kept, the Groups gone, the Photos thrown away. */
class CommitBody {
    var groups: List<CommitGroup>? = null
    var removed: List<GroupRef>? = null
    var discarded: List<UUID>? = null
}

/**
 * Confirm and save: writes the staged review into the batch and saves it as Gowns in one transaction, so a refusal anywhere
 * leaves the batch as it was. Field rules are those of the review edits; the Gowns come from [SaveBatchService].
 * shortcut: a Photo moved in another tab does not change any Group version, so only Group edits and the set of Photos are compared; add a version bump to move/split/merge if one User can review in two places.
 */
@Service
class CommitService(
    private val em: EntityManager,
    private val batches: UploadBatchService,
    private val edits: UploadGroupService,
    private val rearrange: RearrangeService,
    private val save: SaveBatchService,
) {
    @Transactional
    fun commit(userId: UUID, batchId: UUID, body: CommitBody, ip: String?): Saved {
        save.replay(userId, batchId)?.let { return it }
        if (batches.owned(userId, batchId).phase != BatchPhase.REVIEW) throw ProblemException(ProblemCode.CONFLICT)
        val sent = body.groups.orEmpty()
        val removed = body.removed.orEmpty()
        val discarded = body.discarded.orEmpty()
        if (sent.isEmpty()) throw invalid("groups", "required")

        val held = em.createQuery("select g from UploadGroup g where g.batchId = :b", UploadGroup::class.java).setParameter("b", batchId).resultList.associateBy { it.id }
        val loaded = sent.mapNotNull { g -> g.version?.let { g.id to it } } + removed.map { it.id to it.version }
        if (loaded.any { it.first == null || it.second == null }) throw invalid("groups", "invalid")
        if (loaded.size != held.size || loaded.map { it.first }.toSet() != held.keys || loaded.any { (id, v) -> held.getValue(id!!).version != v }) throw ProblemException(ProblemCode.CONFLICT)

        val live = batches.livePhotos(batchId).associateBy { it.id }
        val placed = sent.flatMap { it.photoIds.orEmpty() } + discarded
        if (placed.size != placed.toSet().size) throw invalid("photoIds", "invalid")
        if (placed.toSet() != live.keys) throw ProblemException(ProblemCode.CONFLICT)

        sent.forEachIndexed { i, g ->
            val ids = g.photoIds.orEmpty()
            if (ids.isEmpty()) throw invalid("groups[$i].photoIds", "required")
            val checked = try {
                edits.check(GroupEdit().also { it.name = g.name; it.attributes = g.attributes; it.description = g.description })
            } catch (e: ProblemException) {
                throw ProblemException(e.problem, e.fields.map { FieldProblem("groups[$i].${it.field}", it.code) })
            }
            if (checked.name == null) throw invalid("groups[$i].name", "required")
            val row = if (g.version == null) rearrange.fresh(batchId, checked) else held.getValue(g.id!!).also {
                it.name = checked.name
                checked.tags?.let { t -> it.attributes = Tags(1, t) }
                checked.description?.let { d -> it.description = d }
            }
            ids.forEach { live.getValue(it).groupId = row.id }
        }
        discarded.forEach { live.getValue(it).apply { state = PhotoState.DISCARDED; groupId = null } }
        removed.forEach { em.remove(held.getValue(it.id!!)) }
        em.flush()
        return save.save(userId, batchId, ip)
    }

    private fun invalid(field: String, code: String) = ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem(field, code)))
}
