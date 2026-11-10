package co.klei.app.signature

import co.klei.app.identity.UserService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

data class StudioView(val name: String, val address: String)

/** `preview` is what Send appends (FR-21), already built by [SignatureRenderer]; `studio` is read-only here for every Role. */
data class SignatureView(
    val enabled: Boolean, val signoff: String, val name: String, val title: String, val phone: String,
    val studio: StudioView, val preview: String, val version: Long,
)

class SignatureRequest {
    var enabled: Boolean? = null
    var signoff: String? = null
    var name: String? = null
    var title: String? = null
    var phone: String? = null
}

/** FR-31: each User's own signature. No Audit Entry: personal text, not an Admin action (FR-40 does not list it). */
@Service
class SignatureService(private val em: EntityManager, private val users: UserService, private val workspace: WorkspaceService) {
    @Transactional(readOnly = true)
    fun get(userId: UUID): SignatureView {
        val r = em.find(Signature::class.java, userId)
        return if (r != null) view(r) else blank(userId)
    }

    @Transactional
    fun save(userId: UUID, req: SignatureRequest, ifMatch: Long): SignatureView {
        val problems = check(req)
        if (problems.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, problems)
        val r = em.find(Signature::class.java, userId, LockModeType.PESSIMISTIC_WRITE)
        if (ifMatch != (r?.let(::apiVersion) ?: 0L)) throw ProblemException(ProblemCode.CONFLICT)
        val (on, signoff, name, title, phone) = Cleaned(req)
        val row = r ?: Signature(userId, on, signoff, name, title, phone).also { em.persist(it) }
        row.enabled = on
        row.signoff = signoff
        row.name = name
        row.title = title
        row.phone = phone
        em.flush()
        return view(row)
    }

    private data class Cleaned(val on: Boolean, val signoff: String, val name: String, val title: String, val phone: String) {
        constructor(q: SignatureRequest) : this(q.enabled!!, q.signoff.orEmpty().trim(), q.name.orEmpty().trim(), q.title.orEmpty().trim(), q.phone.orEmpty().trim())
    }

    private fun check(q: SignatureRequest): List<FieldProblem> = buildList {
        if (q.enabled == null) add(FieldProblem("enabled", "required"))
        for ((field, v) in listOf("signoff" to q.signoff, "name" to q.name, "title" to q.title, "phone" to q.phone)) {
            val t = v.orEmpty().trim()
            if (t.length > MAX_LINE) add(FieldProblem(field, "too_long"))
            else if (t.any { it == '\n' || it == '\r' }) add(FieldProblem(field, "invalid"))
        }
    }

    private fun apiVersion(r: Signature) = (r.version ?: -1) + 1

    private fun view(r: Signature): SignatureView = build(r.enabled, r.signoff, r.name, r.title, r.phone, apiVersion(r))

    private fun blank(userId: UUID): SignatureView =
        build(false, DEFAULT_SIGNOFF, users.get(userId)?.name.orEmpty(), "", "", 0)

    private fun build(on: Boolean, signoff: String, name: String, title: String, phone: String, version: Long): SignatureView {
        val studio = workspace.studio()
        return SignatureView(on, signoff, name, title, phone, studio, SignatureRenderer.render(on, signoff, name, title, phone, studio.name, studio.address), version)
    }

    companion object {
        const val MAX_LINE = 80
        const val DEFAULT_SIGNOFF = "Warm regards,"
    }
}
