package co.klei.app.identity

import co.klei.core.identity.DefaultRoles
import co.klei.crypto.ColumnRef
import co.klei.crypto.FieldCodec
import co.klei.crypto.MigrationCrypto
import org.flywaydb.core.api.migration.BaseJavaMigration
import org.flywaydb.core.api.migration.Context
import org.springframework.stereotype.Component
import java.util.UUID

/** Seeds Admin, Staff and Viewer with the default matrix (FR-36). A Java migration because the values are encrypted. */
@Component
class V4__SeedRoles(private val crypto: MigrationCrypto) : BaseJavaMigration() {
    override fun migrate(context: Context) {
        val roleCol = ColumnRef("role", "name")
        val permCol = ColumnRef("role_permission", "permission")
        context.connection.prepareStatement("insert into role (id, version, name_ct) values (?, 0, ?)").use { role ->
            context.connection.prepareStatement("insert into role_permission (id, role_id, permission_ct) values (?, ?, ?)").use { perm ->
                for ((name, permissions) in DefaultRoles.matrix) {
                    val id = UUID.randomUUID()
                    role.setObject(1, id)
                    role.setBytes(2, crypto.encrypt(FieldCodec.enc(name), roleCol, id))
                    role.executeUpdate()
                    for (p in permissions) {
                        val pid = UUID.randomUUID()
                        perm.setObject(1, pid)
                        perm.setObject(2, id)
                        perm.setBytes(3, crypto.encrypt(FieldCodec.enc(p), permCol, pid))
                        perm.executeUpdate()
                    }
                }
            }
        }
    }
}
