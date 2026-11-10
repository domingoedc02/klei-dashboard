package co.klei.app.gown

import co.klei.app.taxonomy.TaxonomyValue
import co.klei.app.upload.TagView
import co.klei.core.taxonomy.TaxonomyType
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.Terms
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.util.UUID

/** Writes `gown_term` for a new Gown from its name, Silhouette and Fabric (architecture §4.2), so a Gown never exists without its words. */
@Component
class TermIndexer(private val em: EntityManager, private val bidx: BlindIndex) {
    fun index(gownId: UUID, name: String, tags: List<TagView>) {
        val text = (listOf(name) + tags.filter { t -> WORD_TYPES.any { it.code == t.type } }.map { it.value }).joinToString(" ")
        for (word in Terms.of(text)) em.persist(GownTerm(UUID.randomUUID(), gownId, bidx.of(BidxDomain.GOWN_TERM, word)))
    }

    /**
     * Rewrites the words of [gowns] from their current name and tags: after an edit, or after a Taxonomy rename.
     * Runs in the caller's transaction. Tags are read once per chunk, not once per Gown.
     */
    fun reindex(gowns: Collection<Gown>) {
        if (gowns.isEmpty()) return
        val values = em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.associateBy { it.id }
        for (chunk in gowns.chunked(CHUNK)) {
            val ids = chunk.map { it.id }
            val tagsBy = em.createQuery("select a from GownAttribute a where a.gownId in :ids", GownAttribute::class.java)
                .setParameter("ids", ids).resultList.groupBy { it.gownId }
            em.createQuery("delete from GownTerm t where t.gownId in :ids").setParameter("ids", ids).executeUpdate()
            for (g in chunk) index(g.id, g.name, tagsBy[g.id].orEmpty().mapNotNull { values[it.taxonomyValueId] }.map { TagView(it.type.code, it.value) })
        }
    }

    companion object {
        private const val CHUNK = 500
        val WORD_TYPES = setOf(TaxonomyType.SILHOUETTE, TaxonomyType.FABRIC)
    }
}
