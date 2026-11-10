package co.klei.core.taxonomy

import java.util.UUID

/** The five lists the studio tags a Gown with (FR-38). The API and the database use [code]. */
enum class TaxonomyType {
    SILHOUETTE, FABRIC, NECKLINE, SLEEVE, TRAIN;

    val code: String get() = name.lowercase()

    companion object {
        fun of(code: String?): TaxonomyType? = entries.firstOrNull { it.code == code }
    }
}

/** Published after a rename so a later search index can follow it (Story 5.3). */
data class TaxonomyChanged(val type: TaxonomyType, val id: UUID)

/** How many Gowns use a value. Story 4.7 replaces the zero implementation once `gown_attribute` exists. */
fun interface UsageCounter {
    fun usedBy(valueId: UUID): Long
}
