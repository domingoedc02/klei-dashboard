package co.klei.app.signature

import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

data class WorkspaceView(val studioName: String, val studioAddress: String, val version: Long)

class WorkspaceRequest {
    var studioName: String? = null
    var studioAddress: String? = null
}

/** FR-31: the Studio's name and address, one row. Admin edit gate is on the controller; every Role reads it through the signature preview. */
@Service
class WorkspaceService(private val em: EntityManager) {
    @Transactional(readOnly = true)
    fun get(): WorkspaceView = em.find(Workspace::class.java, ID)?.let(::view) ?: WorkspaceView("", "", 0)

    @Transactional(readOnly = true)
    fun studio(): StudioView = em.find(Workspace::class.java, ID)?.let { StudioView(it.studioName, it.studioAddress) } ?: StudioView("", "")

    @Transactional
    fun save(req: WorkspaceRequest, ifMatch: Long): WorkspaceView {
        val name = req.studioName.orEmpty().trim()
        val lines = req.studioAddress.orEmpty().lines().map { it.trim() }.filter { it.isNotEmpty() }
        val address = lines.joinToString("\n")
        val problems = buildList {
            if (name.length > MAX_NAME) add(FieldProblem("studioName", "too_long"))
            else if (name.any { it == '\n' || it == '\r' }) add(FieldProblem("studioName", "invalid"))
            if (lines.size > MAX_LINES) add(FieldProblem("studioAddress", "too_many_lines"))
            else if (address.length > MAX_ADDRESS) add(FieldProblem("studioAddress", "too_long"))
        }
        if (problems.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, problems)
        val r = em.find(Workspace::class.java, ID, LockModeType.PESSIMISTIC_WRITE)
        if (ifMatch != (r?.let(::apiVersion) ?: 0L)) throw ProblemException(ProblemCode.CONFLICT)
        val row = r ?: Workspace(ID, name, address).also { em.persist(it) }
        row.studioName = name
        row.studioAddress = address
        em.flush()
        return view(row)
    }

    private fun apiVersion(r: Workspace) = (r.version ?: -1) + 1

    private fun view(r: Workspace) = WorkspaceView(r.studioName, r.studioAddress, apiVersion(r))

    companion object {
        val ID: UUID = UUID.fromString("00000000-0000-4000-8000-0000000000b1")
        const val MAX_NAME = 80
        const val MAX_ADDRESS = 240
        const val MAX_LINES = 4
    }
}
