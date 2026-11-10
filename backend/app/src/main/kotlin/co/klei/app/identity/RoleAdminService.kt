package co.klei.app.identity

import co.klei.core.audit.AuditAction
import co.klei.app.security.PermissionEpoch
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.Permission
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

data class RoleView(val id: UUID, val name: String, val locked: Boolean, val permissions: List<String>, val version: Long)

/** `permissions` are the editable names, in matrix row order. */
data class RoleMatrix(val permissions: List<String>, val roles: List<RoleView>)

/**
 * The Role by Permission matrix (FR-36). A change replaces one Role's set under a write lock on its `role` row, bumps the
 * permission epoch in the same transaction (every access token goes stale at once, AD-9) and leaves refresh families alone,
 * so the shell refreshes and gets the new Permissions. The Admin Role is locked.
 */
@Service
class RoleAdminService(
    private val em: EntityManager,
    private val users: UserService,
    private val roles: RoleService,
    private val epoch: PermissionEpoch,
    private val audit: AuditService,
) {
    @Transactional(readOnly = true)
    fun matrix(): RoleMatrix {
        val admin = roles.adminRoleId()
        val granted = em.createQuery("select p from RolePermission p", RolePermission::class.java).resultList
            .groupBy({ it.roleId }, { it.permission })
        val views = roles.roles().map { view(it, it.id == admin, granted[it.id].orEmpty().toSet()) }
            .sortedBy { ORDER.indexOf(it.name).let { i -> if (i < 0) ORDER.size else i } }
        return RoleMatrix(EDITABLE.map { it.name }, views)
    }

    /** 422 for the Admin Role, an unknown Role or a Permission that is unknown or not editable; 409 for a stale [ifMatch]. */
    @Transactional
    fun replace(roleId: UUID, wanted: Set<String>, ifMatch: Long, by: UUID, ip: String?): RoleView {
        val want = wanted.map { n -> EDITABLE.firstOrNull { it.name == n } ?: throw ProblemException(ProblemCode.VALIDATION_FAILED) }.toSet()
        val actor = users.get(by)?.name ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)
        // Nothing may load this Role before the lock: the version below must be the committed one.
        val role = em.find(Role::class.java, roleId, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.VALIDATION_FAILED)
        if (role.id == roles.adminRoleId()) throw ProblemException(ProblemCode.VALIDATION_FAILED)
        if (ifMatch != role.version) throw ProblemException(ProblemCode.CONFLICT)

        val rows = em.createQuery("select p from RolePermission p where p.roleId = :r", RolePermission::class.java)
            .setParameter("r", roleId).resultList
        val have = rows.map { it.permission }.toSet()
        if (have == want) return view(role, false, want)

        rows.filter { it.permission !in want }.forEach(em::remove)
        (want - have).forEach { em.persist(RolePermission(UUID.randomUUID(), roleId, it)) }
        em.lock(role, LockModeType.PESSIMISTIC_FORCE_INCREMENT)
        em.flush()
        epoch.bump()
        val changes = (want - have).map { "+${it.name}" } + (have - want).map { "-${it.name}" }
        audit.record(AuditAction.ROLE_PERMISSIONS_CHANGED, detail = "${role.name}: ${changes.sorted().joinToString(" ")}", actorId = by, actorName = actor, ip = ip)
        return view(role, false, want)
    }

    private fun view(r: Role, locked: Boolean, granted: Set<Permission>) =
        RoleView(r.id, r.name, locked, EDITABLE.filter { it in granted }.map { it.name }, r.version ?: 0)

    private companion object {
        val EDITABLE = Permission.entries.filter { it.editable }
        val ORDER = listOf(DefaultRoles.ADMIN, DefaultRoles.STAFF, DefaultRoles.VIEWER)
    }
}
