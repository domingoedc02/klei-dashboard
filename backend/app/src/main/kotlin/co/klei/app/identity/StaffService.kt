package co.klei.app.identity

import co.klei.core.audit.AuditAction
import co.klei.app.auth.CredentialService
import co.klei.app.auth.RefreshService
import co.klei.app.auth.TwoFactorService
import co.klei.app.security.PermissionEpoch
import co.klei.app.upload.UploadBatchService
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.identity.UserStatus
import co.klei.core.notification.NotificationPort
import co.klei.core.notification.NotificationType
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

data class StaffRow(
    val id: UUID, val name: String, val email: String, val roleId: UUID, val role: String, val status: String,
    val lastActive: String?, val hasAvatar: Boolean, val lastAdmin: Boolean, val version: Long, val twoFactor: Boolean = false,
)

data class RoleRef(val id: UUID, val name: String)

/** `next` is always null: a studio's staff fits one page. `roles` feeds the Role select. */
data class StaffList(val items: List<StaffRow>, val next: String?, val total: Int, val roles: List<RoleRef>)

/**
 * Staff administration (FR-35). Every change that could remove the last Active Admin takes a lock on the Admin `role` row first,
 * so two Admins demoting or deleting each other at the same moment cannot both pass the check.
 */
@Service
class StaffService(
    private val em: EntityManager,
    private val users: UserService,
    private val roles: RoleService,
    private val credentials: CredentialService,
    private val refresh: RefreshService,
    private val epoch: PermissionEpoch,
    private val audit: AuditService,
    private val uploads: UploadBatchService,
    private val notifier: NotificationPort,
    private val twoFactor: TwoFactorService,
) {
    @Transactional(readOnly = true)
    fun list(): StaffList {
        val all = em.createQuery("select u from AppUser u", AppUser::class.java).resultList.sortedBy { it.name.lowercase() }
        val names = roles.roles()
        val sole = activeAdmins(all).singleOrNull()?.id
        val withTwoFactor = twoFactor.activeIds()
        return StaffList(all.map { row(it, names, it.id == sole, it.id in withTwoFactor) }, null, all.size, names.map { RoleRef(it.id, it.name) }.sortedBy { it.name })
    }

    @Transactional
    fun update(id: UUID, name: String?, email: String?, roleId: UUID?, ifMatch: Long, by: UUID, ip: String?): StaffRow {
        val actor = actorName(by)
        lockAdmins()
        val u = users.get(id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (ifMatch != u.version) throw ProblemException(ProblemCode.CONFLICT)
        val names = roles.roles()
        if (roleId != null && names.none { it.id == roleId }) throw ProblemException(ProblemCode.VALIDATION_FAILED)
        if (email != null && users.find(email)?.let { it.id != id } == true) throw ProblemException(ProblemCode.CONFLICT)
        val newRole = roleId ?: u.roleId
        val roleChanged = newRole != u.roleId
        val emailChanged = email != null && email != u.email
        if (roleChanged && losesLastAdmin(u)) throw ProblemException(ProblemCode.CONFLICT)

        name?.let { u.name = it }
        email?.let { u.email = it }
        u.roleId = newRole
        val invited = u.status == UserStatus.INVITED
        if (invited && (roleChanged || emailChanged)) credentials.reinvite(u, by)
        em.flush()
        val out = row(u, names, lastAdmin = false)
        if (roleChanged) {
            epoch.bump()
            if (!invited) refresh.revokeAllFor(id)
            notifier.notify(NotificationType.TEAM_ACTIVITY, roles.adminIds().filter { it != by }, "${out.name} is now ${out.role}", "settings")
        }
        audit.record(if (roleChanged) AuditAction.USER_ROLE_CHANGED else AuditAction.USER_UPDATED, detail = out.name, actorId = by, actorName = actor, ip = ip)
        return out
    }

    @Transactional
    fun resend(id: UUID, by: UUID, ip: String?) {
        val actor = actorName(by)
        val u = users.get(id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (u.status != UserStatus.INVITED) throw ProblemException(ProblemCode.CONFLICT)
        credentials.reinvite(u, by)
        audit.record(AuditAction.USER_INVITE_RESENT, detail = u.name, actorId = by, actorName = actor, ip = ip)
    }

    /** FR-44: clears another User's second factor (a lost device with no recovery code). Their open sign-ins stay; the next one needs only the password. */
    @Transactional
    fun resetTwoFactor(id: UUID, by: UUID, ip: String?) {
        val actor = actorName(by)
        val u = users.get(id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        twoFactor.reset(id)
        audit.record(AuditAction.TWOFA_RESET, detail = u.name, actorId = by, actorName = actor, ip = ip)
    }

    /** Hard delete. Their sign-ins end at once; invitations they sent move to the Admin who deletes them, so those links keep working. */
    @Transactional
    fun delete(id: UUID, by: UUID, ip: String?) {
        val actor = actorName(by)
        lockAdmins()
        val u = users.get(id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (losesLastAdmin(u)) throw ProblemException(ProblemCode.CONFLICT)
        val name = u.name
        em.flush()
        refresh.revokeAllFor(id)
        em.createQuery("delete from AuthCredential c where c.userId = :u").setParameter("u", id).executeUpdate()
        em.createQuery("update AuthCredential c set c.invitedBy = :by where c.invitedBy = :u").setParameter("by", by).setParameter("u", id).executeUpdate()
        uploads.discard(id)
        em.remove(em.find(AppUser::class.java, id))
        em.flush()
        epoch.bump()
        audit.record(AuditAction.USER_DELETED, detail = name, actorId = by, actorName = actor, ip = ip)
    }

    private fun lockAdmins() { em.find(Role::class.java, roles.adminRoleId(), LockModeType.PESSIMISTIC_WRITE) }

    private fun activeAdmins(all: List<AppUser>): List<AppUser> {
        val admin = roles.adminRoleId()
        return all.filter { it.roleId == admin && it.status == UserStatus.ACTIVE }
    }

    /** True when removing [u] from the Admin Role (by demotion or deletion) leaves no Active Admin. */
    private fun losesLastAdmin(u: AppUser): Boolean {
        if (u.roleId != roles.adminRoleId() || u.status != UserStatus.ACTIVE) return false
        val admin = roles.adminRoleId()
        val others = em.createQuery("select a from AppUser a where a.roleId = :r and a.id <> :id", AppUser::class.java)
            .setParameter("r", admin).setParameter("id", u.id).resultList
        return others.none { it.status == UserStatus.ACTIVE }
    }

    private fun actorName(id: UUID): String = users.get(id)?.name ?: throw ProblemException(ProblemCode.UNAUTHENTICATED)

    private fun row(u: AppUser, names: List<Role>, lastAdmin: Boolean, twoFactor: Boolean = false) = StaffRow(
        u.id, u.name, u.email, u.roleId, names.firstOrNull { it.id == u.roleId }?.name.orEmpty(),
        if (u.status == UserStatus.ACTIVE) "active" else "invited",
        u.lastActive?.toString(), u.avatarObjectId != null, lastAdmin, u.version ?: 0, twoFactor,
    )
}
