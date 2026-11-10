package co.klei.app.upload

/** The longest description a Group keeps, from the provider or from a Staff member. */
const val MAX_DESCRIPTION = 2000

/** Keeps only what the Taxonomy allows (FR-9): the provider suggests, the studio's own values decide. */
object TaxonomyMapper {
    const val MAX_NAME = 80

    /** Case-insensitive exact match, stored with the Taxonomy's own spelling, once per value; unknown types and values are dropped. */
    fun map(answer: Map<String, List<String>>, allowed: Map<String, List<String>>): List<Tag> =
        allowed.flatMap { (type, values) ->
            val named = answer[type].orEmpty().map { it.trim().lowercase() }.toSet()
            values.filter { it.lowercase() in named }.map { Tag(type, it) }
        }

    fun name(raw: String, fallback: String): String = raw.trim().take(MAX_NAME).trim().ifEmpty { fallback }

    /** How many values the provider named, blanks aside. */
    fun named(answer: Map<String, List<String>>): Int = answer.values.sumOf { v -> v.count { it.isNotBlank() } }
}

/** How alike the photos are, scaled down by how little of the provider's answer the Taxonomy accepted. It can only lower the score. */
object ConfidenceScorer {
    /** [mapped] over [named] is the accepted share; naming nothing scores 0 there, so an empty answer can never reach Medium. */
    fun score(similarity: Int, mapped: Int, named: Int): Int {
        val n = named.coerceAtLeast(1)
        val m = if (named <= 0) 0 else mapped.coerceIn(0, n)
        return (similarity.coerceIn(0, 100) * (70 * n + 30 * m) / (100 * n)).coerceIn(0, 100)
    }
}
