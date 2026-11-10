package co.klei.app.identity

import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.Permission
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** Role names and permissions are encrypted, so lookups decrypt the whole (tiny) table in memory (architecture §4.4). */
@Service
class RoleService(private val em: EntityManager) {
    @Transactional(readOnly = true)
    fun roles(): List<Role> = em.createQuery("select r from Role r", Role::class.java).resultList

    @Transactional(readOnly = true)
    fun adminRoleId(): UUID = roles().first { it.name == DefaultRoles.ADMIN }.id

    @Transactional(readOnly = true)
    fun permissions(roleId: UUID): Set<Permission> =
        em.createQuery("select p from RolePermission p where p.roleId = :r", RolePermission::class.java)
            .setParameter("r", roleId).resultList.map { it.permission }.toSet()

    @Transactional(readOnly = true)
    fun adminIds(): List<UUID> =
        em.createQuery("select u.id from AppUser u where u.roleId = :r", UUID::class.java).setParameter("r", adminRoleId()).resultList

    @Transactional(readOnly = true)
    fun adminExists(): Boolean =
        em.createQuery("select count(u) from AppUser u where u.roleId = :r", Long::class.javaObjectType)
            .setParameter("r", adminRoleId()).singleResult > 0
}
