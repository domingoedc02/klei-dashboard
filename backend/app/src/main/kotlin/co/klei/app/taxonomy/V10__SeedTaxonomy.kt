package co.klei.app.taxonomy

import co.klei.core.taxonomy.TaxonomyType
import co.klei.crypto.ColumnRef
import co.klei.crypto.FieldCodec
import co.klei.crypto.MigrationCrypto
import org.flywaydb.core.api.migration.BaseJavaMigration
import org.flywaydb.core.api.migration.Context
import org.springframework.stereotype.Component
import java.util.UUID

/** Seed values from the PRD glossary (wireframe `js/data.js`), encrypted like any other row (NFR-1). */
@Component
class V10__SeedTaxonomy(private val crypto: MigrationCrypto) : BaseJavaMigration() {
    override fun migrate(context: Context) {
        val typeCol = ColumnRef("taxonomy_value", "type")
        val valueCol = ColumnRef("taxonomy_value", "value")
        context.connection.prepareStatement("insert into taxonomy_value (id, version, type_ct, value_ct) values (?, 0, ?, ?)").use { st ->
            for ((type, values) in SEED) for (v in values) {
                val id = UUID.randomUUID()
                st.setObject(1, id)
                st.setBytes(2, crypto.encrypt(FieldCodec.enc(type), typeCol, id))
                st.setBytes(3, crypto.encrypt(FieldCodec.enc(v), valueCol, id))
                st.addBatch()
            }
            st.executeBatch()
        }
    }

    companion object {
        val SEED: Map<TaxonomyType, List<String>> = mapOf(
            TaxonomyType.SILHOUETTE to listOf("A-line", "Mermaid", "Ball gown"),
            TaxonomyType.FABRIC to listOf("Mikado", "Tulle", "Lace"),
            TaxonomyType.NECKLINE to listOf("Sweetheart", "V-neck", "Off-shoulder", "Bateau", "Square"),
            TaxonomyType.SLEEVE to listOf("Strapless", "Cap sleeve", "Long sleeve", "Sheer long sleeve"),
            TaxonomyType.TRAIN to listOf("Sweep", "Chapel", "Cathedral", "None"),
        )
    }
}
