package co.klei.app.security

import jakarta.persistence.Entity
import jakarta.persistence.EntityManager
import jakarta.persistence.Id
import jakarta.persistence.LockModeType
import jakarta.persistence.Table
import jakarta.persistence.Version
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** The one `permission_epoch` row; its `version` is the counter (AD-9). */
@Entity
@Table(name = "permission_epoch")
class PermissionEpochRow(@Id val id: UUID, @Version var version: Long)

/** Any change to Role or Permission bumps the epoch, so tokens minted before it are stale at once. */
@Service
class PermissionEpoch(private val em: EntityManager) {
    @Transactional(readOnly = true)
    fun current(): Long = em.createQuery("select e.version from PermissionEpochRow e", Long::class.javaObjectType).singleResult

    @Transactional
    fun bump(): Long {
        val row = em.find(PermissionEpochRow::class.java, ROW, LockModeType.PESSIMISTIC_FORCE_INCREMENT)
        em.flush()
        return row.version
    }

    private companion object {
        val ROW: UUID = UUID.fromString("00000000-0000-4000-8000-000000000001")
    }
}
