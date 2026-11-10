package co.klei.app.gown

import co.klei.core.taxonomy.TaxonomyChanged
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component
import jakarta.persistence.EntityManager

/**
 * A Taxonomy rename changes the words of every Gown that uses the value (FR-16). Runs inside the rename's own transaction,
 * so a failure rolls the rename back instead of leaving the search words stale.
 */
@Component
class GownTermListener(private val em: EntityManager, private val terms: TermIndexer) {
    @EventListener
    fun on(e: TaxonomyChanged) {
        if (e.type !in TermIndexer.WORD_TYPES) return
        val gowns = em.createQuery(
            "select g from Gown g where exists (select 1 from GownAttribute a where a.gownId = g.id and a.taxonomyValueId = :v)", Gown::class.java,
        ).setParameter("v", e.id).resultList
        terms.reindex(gowns)
    }
}
