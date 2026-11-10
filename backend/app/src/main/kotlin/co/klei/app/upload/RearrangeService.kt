package co.klei.app.upload

import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** [seed] gives a new Group its name, tags and description; Undo uses it to bring back a Group that was removed. */
class MoveBody {
    var groupId: UUID? = null
    var seed: GroupEdit? = null
}

class SplitBody {
    var photoIds: List<UUID>? = null
    var seed: GroupEdit? = null
}

class MergeBody {
    var sourceId: UUID? = null
    var targetId: UUID? = null
}

/** The Groups after a change, in review order, and the one the screen should select (null when it is gone). */
data class Rearranged(val groups: List<GroupView>, val focus: UUID?)

/**
 * Moving, splitting, merging and discarding Photos in review (FR-11). Everything stays in the database until Save, so
 * nothing here deletes an object. `If-Match` is the version of the Group the change takes Photos from.
 */
@Service
class RearrangeService(
    private val em: EntityManager,
    private val batches: UploadBatchService,
    private val edits: UploadGroupService,
    private val grouping: GroupingService,
) {
    @Transactional
    fun move(userId: UUID, batchId: UUID, photoId: UUID, body: MoveBody, ifMatch: Long): Rearranged {
        review(userId, batchId)
        val photo = live(batchId, photoId)
        val from = group(batchId, photo.groupId)
        stale(from, ifMatch)
        if (body.groupId == from.id) return result(batchId, from.id)
        val to = place(batchId, photo, body.groupId, body.seed)
        drop(batchId, from)
        return result(batchId, to.id)
    }

    @Transactional
    fun split(userId: UUID, batchId: UUID, groupId: UUID, body: SplitBody, ifMatch: Long): Rearranged {
        review(userId, batchId)
        val from = group(batchId, groupId)
        stale(from, ifMatch)
        val ids = body.photoIds.orEmpty()
        val mine = batches.livePhotos(batchId).filter { it.groupId == from.id }
        val picked = mine.filter { it.id in ids }
        when {
            ids.isEmpty() -> throw invalid("photoIds", "required")
            ids.toSet().size != ids.size || picked.size != ids.size -> throw invalid("photoIds", "invalid")
            picked.size == mine.size -> throw invalid("photoIds", "all")
        }
        val to = fresh(batchId, body.seed?.let(edits::check))
        picked.forEach { it.groupId = to.id }
        return result(batchId, to.id)
    }

    @Transactional
    fun merge(userId: UUID, batchId: UUID, body: MergeBody, ifMatch: Long): Rearranged {
        review(userId, batchId)
        val sourceId = body.sourceId ?: throw invalid("sourceId", "required")
        val targetId = body.targetId ?: throw invalid("targetId", "required")
        if (sourceId == targetId) throw invalid("targetId", "invalid")
        val source = group(batchId, sourceId)
        val target = group(batchId, targetId)
        stale(source, ifMatch)
        batches.livePhotos(batchId).filter { it.groupId == source.id }.forEach { it.groupId = target.id }
        em.remove(source)
        return result(batchId, target.id)
    }

    @Transactional
    fun discard(userId: UUID, batchId: UUID, photoId: UUID, ifMatch: Long): Rearranged {
        review(userId, batchId)
        val photo = live(batchId, photoId)
        val from = group(batchId, photo.groupId)
        stale(from, ifMatch)
        photo.state = PhotoState.DISCARDED
        photo.groupId = null
        return result(batchId, from.id.takeUnless { drop(batchId, from) })
    }

    /** Undo of a discard: the Photo returns to a Group, or to a new one. */
    @Transactional
    fun restore(userId: UUID, batchId: UUID, photoId: UUID, body: MoveBody): Rearranged {
        review(userId, batchId)
        val photo = batches.photoOf(batchId, photoId)
        if (photo.state == null) throw ProblemException(ProblemCode.CONFLICT)
        return result(batchId, place(batchId, photo, body.groupId, body.seed).id)
    }

    private fun review(userId: UUID, batchId: UUID) {
        if (batches.owned(userId, batchId).phase != BatchPhase.REVIEW) throw ProblemException(ProblemCode.CONFLICT)
    }

    private fun live(batchId: UUID, photoId: UUID): Photo =
        batches.photoOf(batchId, photoId).takeIf { it.state == null } ?: throw ProblemException(ProblemCode.NOT_FOUND)

    private fun group(batchId: UUID, id: UUID?): UploadGroup =
        id?.let { em.find(UploadGroup::class.java, it) }?.takeIf { it.batchId == batchId } ?: throw ProblemException(ProblemCode.NOT_FOUND)

    private fun stale(g: UploadGroup, ifMatch: Long) {
        if (g.version != ifMatch) throw ProblemException(ProblemCode.CONFLICT)
    }

    private fun invalid(field: String, code: String) = ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem(field, code)))

    private fun place(batchId: UUID, photo: Photo, targetId: UUID?, seed: GroupEdit?): UploadGroup {
        val checked = seed?.let(edits::check)
        val to = if (targetId != null) group(batchId, targetId) else fresh(batchId, checked)
        photo.groupId = to.id
        photo.state = null
        return to
    }

    /** A Group the Staff member made: low confidence, so it asks for a look. */
    internal fun fresh(batchId: UUID, c: Checked?): UploadGroup {
        val next = (all(batchId).maxOfOrNull { it.position } ?: -1) + 1
        val g = UploadGroup(UUID.randomUUID(), batchId, c?.name ?: NEW_NAME, NEW_CONFIDENCE, next)
        c?.tags?.let { g.attributes = Tags(1, it) }
        c?.description?.let { g.description = it }
        em.persist(g)
        return g
    }

    /** A Group left without Photos goes away; true when it did. */
    private fun drop(batchId: UUID, g: UploadGroup): Boolean {
        if (batches.photos(batchId).any { it.groupId == g.id }) return false
        em.remove(g)
        return true
    }

    private fun all(batchId: UUID) =
        em.createQuery("select g from UploadGroup g where g.batchId = :b", UploadGroup::class.java).setParameter("b", batchId).resultList

    private fun result(batchId: UUID, focus: UUID?): Rearranged {
        em.flush()
        return Rearranged(grouping.groups(batchId), focus)
    }

    private companion object {
        const val NEW_NAME = "New group"
        const val NEW_CONFIDENCE = 70
    }
}
