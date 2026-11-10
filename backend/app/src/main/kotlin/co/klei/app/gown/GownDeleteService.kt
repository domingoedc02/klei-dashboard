package co.klei.app.gown

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.upload.Embedding
import co.klei.app.upload.Photo
import co.klei.app.upload.StoredObject
import co.klei.app.upload.UploadBatchService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

class DeleteResult(val deleted: Int, val missing: List<UUID>)

/** FR-18: hard delete. Rows go in one transaction; the S3 objects go after commit, and a failure there is left for the nightly sweep. */
@Service
class GownDeleteService(private val em: EntityManager, private val batches: UploadBatchService, private val audit: AuditService, private val users: UserService) {
    companion object {
        const val MAX = 100
        private const val NAMED = 10
    }

    @Transactional
    fun delete(ids: List<UUID>, by: UUID, ip: String?): DeleteResult {
        val wanted = ids.distinct()
        if (wanted.isEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("ids", "required")))
        if (wanted.size > MAX) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("ids", "too_many")))

        val gowns = em.createQuery("select g from Gown g where g.id in :ids", Gown::class.java).setParameter("ids", wanted).resultList.associateBy { it.id }
        val missing = wanted.filter { it !in gowns }
        if (gowns.isEmpty()) return DeleteResult(0, missing)

        val photos = em.createQuery("select p from Photo p where p.gownId in :ids", Photo::class.java).setParameter("ids", gowns.keys).resultList
        val objectIds = photos.flatMap { listOf(it.originalObjectId, it.thumbObjectId) }
        if (photos.isNotEmpty()) em.createQuery("delete from Embedding e where e.photoId in :ids").setParameter("ids", photos.map { it.id }).executeUpdate()
        photos.forEach { em.remove(it) }
        em.flush()
        // gown_attribute and gown_term go with the Gown (ON DELETE CASCADE).
        gowns.values.forEach { em.remove(it) }
        em.flush()
        if (objectIds.isNotEmpty()) em.createQuery("delete from StoredObject o where o.id in :ids").setParameter("ids", objectIds).executeUpdate()

        // The detail column is encrypted like the rest of the Audit Entry; the names are all that is left to say what went.
        val names = wanted.mapNotNull { gowns[it]?.name }
        val shown = names.take(NAMED).joinToString("; ") + if (names.size > NAMED) "; and ${names.size - NAMED} more" else ""
        audit.record(AuditAction.GOWN_DELETED, "gowns=${gowns.size} photos=${photos.size} names=$shown", by, users.get(by)?.name ?: "unknown", ip)
        batches.deleteAfterCommit(objectIds)
        return DeleteResult(gowns.size, missing)
    }
}
