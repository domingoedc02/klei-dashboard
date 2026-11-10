package co.klei.app.identity

import co.klei.core.identity.DefaultRoles
import co.klei.core.identity.Permission
import co.klei.crypto.ColumnRef
import co.klei.crypto.FieldCodec
import co.klei.crypto.MigrationCrypto
import org.flywaydb.core.api.migration.BaseJavaMigration
import org.flywaydb.core.api.migration.Context
import org.springframework.stereotype.Component
import java.util.UUID

/**
 * Story 11.12: PERM_AWAY for the Admin Role of a database that V4 already seeded. A new database got it from V4 (the matrix lists
 * every Permission), so this finds it there and does nothing. Bumps the permission epoch so every token carries it after refresh.
 */
@Component
class V23_1__GrantAway(private val crypto: MigrationCrypto) : BaseJavaMigration() {
    override fun migrate(context: Context) {
        val c = context.connection
        val roleCol = ColumnRef("role", "name")
        val permCol = ColumnRef("role_permission", "permission")
        val wanted = String(FieldCodec.enc(Permission.PERM_AWAY), Charsets.UTF_8)
        val admin: UUID = c.createStatement().use { st ->
            st.executeQuery("select id, name_ct from role").use { rs ->
                var found: UUID? = null
                while (rs.next()) {
                    val id = rs.getObject(1, UUID::class.java)
                    if (String(crypto.decrypt(rs.getBytes(2), roleCol, id), Charsets.UTF_8) == DefaultRoles.ADMIN) found = id
                }
                found
            }
        } ?: return
        val has = c.prepareStatement("select id, permission_ct from role_permission where role_id = ?").use { st ->
            st.setObject(1, admin)
            st.executeQuery().use { rs ->
                var any = false
                while (rs.next()) if (String(crypto.decrypt(rs.getBytes(2), permCol, rs.getObject(1, UUID::class.java)), Charsets.UTF_8) == wanted) any = true
                any
            }
        }
        if (has) return
        val pid = UUID.randomUUID()
        c.prepareStatement("insert into role_permission (id, role_id, permission_ct) values (?, ?, ?)").use { st ->
            st.setObject(1, pid)
            st.setObject(2, admin)
            st.setBytes(3, crypto.encrypt(FieldCodec.enc(Permission.PERM_AWAY), permCol, pid))
            st.executeUpdate()
        }
        c.createStatement().use { it.executeUpdate("update permission_epoch set version = version + 1") }
    }
}
