package co.klei.app.identity

import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

data class ProfileView(val name: String, val email: String, val avatar: Long?, val version: Long)

/** FR-30: a User edits only their own name. Email changes go through an Admin (A-UX9). No Audit Entry: personal data, not an admin action. */
@Service
class ProfileService(private val users: UserService, private val avatars: AvatarService) {
    companion object { const val MAX_NAME = 80 }

    @Transactional(readOnly = true)
    fun get(id: UUID): ProfileView = view(users.get(id) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED))

    @Transactional
    fun rename(id: UUID, name: String?, ifMatch: Long): ProfileView {
        val u = users.get(id) ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        if (ifMatch != u.version) throw ProblemException(ProblemCode.CONFLICT)
        val n = name?.trim().orEmpty()
        if (n.isEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("name", "required")))
        if (n.length > MAX_NAME) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("name", "too_long")))
        u.name = n
        users.flush()
        return view(u)
    }

    private fun view(u: AppUser) = ProfileView(u.name, u.email, avatars.revision(u), u.version ?: 0)
}
