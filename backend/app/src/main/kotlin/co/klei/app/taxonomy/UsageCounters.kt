package co.klei.app.taxonomy

import co.klei.app.gown.GownAttribute
import co.klei.app.upload.UploadGroup
import co.klei.core.taxonomy.UsageCounter
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.util.UUID

/** Gowns plus review Groups that carry a tag value (FR-38). Groups name their tags in text, so the count compares type and value. */
@Component
class GownUsageCounter(private val em: EntityManager) : UsageCounter {
    override fun usedBy(valueId: UUID): Long {
        val gowns = em.createQuery("select count(a) from GownAttribute a where a.taxonomyValueId = :v", Long::class.javaObjectType)
            .setParameter("v", valueId).singleResult
        val tag = em.find(TaxonomyValue::class.java, valueId) ?: return gowns
        // shortcut: decrypts every Group of every open batch (one batch per User); add a plaintext-free index if batches ever pile up.
        val groups = em.createQuery("select g from UploadGroup g", UploadGroup::class.java).resultList
            .count { g -> g.attributes.items.any { it.type == tag.type.code && it.value == tag.value } }
        return gowns + groups
    }
}
