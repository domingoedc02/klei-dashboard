package co.klei.app.gown

import com.fasterxml.jackson.annotation.JsonProperty
import co.klei.app.taxonomy.TaxonomyValue
import co.klei.app.upload.ImageType
import co.klei.app.upload.confidenceBand
import co.klei.app.upload.ObjectVault
import co.klei.app.upload.Photo
import co.klei.app.upload.StoredObject
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.taxonomy.TaxonomyType
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.DayBucket
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID

/** One Gallery card: labels are Taxonomy values in plain words, [thumbs] the first four Photos oldest first. */
data class GownCard(
    val id: UUID,
    val name: String,
    val silhouette: List<String>,
    val fabric: List<String>,
    val photos: Int,
    val thumbs: List<UUID>,
    val addedAt: Instant,
    @get:JsonProperty("isNew") val isNew: Boolean,
)

/** [next] is the cursor for the following page (null on the last), [total] all Gowns, [matching] those passing the filters. */
data class GownPage(val items: List<GownCard>, val next: Long?, val total: Long, val matching: Long)

class GownPhoto(val id: UUID, val size: Long)
class GownTags(val type: String, val values: List<String>)

/** One Gown for the viewer: [photos] in upload order, [attributes] only for types that have a value, [band] as in review. */
class GownDetail(
    val id: UUID,
    val name: String,
    val attributes: List<GownTags>,
    val photos: List<GownPhoto>,
    val photoCount: Int,
    val addedAt: Instant,
    val confidence: Int,
    val band: String,
    val description: String?,
    val version: Long,
)

/** Photos of Gowns saved this calendar month, and how many Gowns hold them. */
data class MonthStats(val photos: Long, val gowns: Long)

class GownFilter(val silhouette: List<UUID>, val fabric: List<UUID>, val days: Int, val before: Long?, val limit: Int)

object GalleryLimits {
    const val DEFAULT_LIMIT = 48
    const val MAX_LIMIT = 100
    const val MAX_IDS = 50
    val DAYS = setOf(0, 7, 30, 90)
}

/** FR-13/FR-14: the Gallery read side. SQL only sees ids, `seq` and the creation-day HMAC; names and labels are decrypted after the page is chosen. */
@Service
class GownQueryService(private val em: EntityManager, private val bidx: BlindIndex, private val vault: ObjectVault) {

    @Transactional(readOnly = true)
    fun query(f: GownFilter): GownPage {
        val tags = em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.associateBy { it.id }
        val sil = scoped(f.silhouette, tags, TaxonomyType.SILHOUETTE)
        val fab = scoped(f.fabric, tags, TaxonomyType.FABRIC)
        val days = if (f.days > 0) DayBucket.lastN(f.days).map { bidx.of(BidxDomain.GOWN_DAY, it) } else emptyList()

        val clauses = mutableListOf<String>()
        val params = mutableMapOf<String, Any>()
        if (sil.isNotEmpty()) { clauses += "exists (select 1 from GownAttribute a where a.gownId = g.id and a.taxonomyValueId in :sil)"; params["sil"] = sil }
        if (fab.isNotEmpty()) { clauses += "exists (select 1 from GownAttribute b where b.gownId = g.id and b.taxonomyValueId in :fab)"; params["fab"] = fab }
        if (days.isNotEmpty()) { clauses += "g.dayBidx in :days"; params["days"] = days }
        val filtered = if (clauses.isEmpty()) "" else clauses.joinToString(" and ", " where ")

        val total = em.createQuery("select count(g) from Gown g", Long::class.javaObjectType).singleResult.toLong()
        val matching = count("select count(g) from Gown g$filtered", params)

        val pageClauses = if (f.before == null) filtered else (if (filtered.isEmpty()) " where " else "$filtered and ") + "g.seq < :before"
        val pageQuery = em.createQuery("select g from Gown g$pageClauses order by g.seq desc", Gown::class.java)
        params.forEach { (k, v) -> pageQuery.setParameter(k, v) }
        f.before?.let { pageQuery.setParameter("before", it) }
        val rows = pageQuery.setMaxResults(f.limit + 1).resultList
        val page = rows.take(f.limit)
        return GownPage(cards(page, tags), if (rows.size > f.limit) page.last().seq else null, total, matching)
    }

    /**
     * Gowns saved, and their Photos, from the 1st of [now]'s month to [now]. Creation days are the only queryable date, so this is a `dayBidx in` over at most 31 buckets.
     * shortcut: UTC month edges, switch to per-User buckets if the studio reports off-by-a-day at month end.
     */
    @Transactional(readOnly = true)
    fun monthStats(now: Instant): MonthStats {
        val today = now.atZone(ZoneOffset.UTC).toLocalDate()
        val days = (1..today.dayOfMonth).map { bidx.of(BidxDomain.GOWN_DAY, today.withDayOfMonth(it).toString()) }
        val p = mapOf<String, Any>("days" to days)
        return MonthStats(
            count("select count(p) from Photo p, Gown g where p.gownId = g.id and g.dayBidx in :days", p),
            count("select count(g) from Gown g where g.dayBidx in :days", p),
        )
    }

    @Transactional(readOnly = true)
    fun detail(id: UUID): GownDetail {
        val g = em.find(Gown::class.java, id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val tags = em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.associateBy { it.id }
        val mine = em.createQuery("select a from GownAttribute a where a.gownId = :g", GownAttribute::class.java).setParameter("g", id).resultList
            .mapNotNull { tags[it.taxonomyValueId] }
        val photos = em.createQuery("select p from Photo p where p.gownId = :g", Photo::class.java).setParameter("g", id).resultList
            .sortedWith(compareBy({ it.createdAt }, { it.id })).map { GownPhoto(it.id, it.size) }
        val attributes = TaxonomyType.entries.mapNotNull { t ->
            mine.filter { it.type == t }.map { it.value }.sortedBy { it.lowercase() }.takeIf { it.isNotEmpty() }?.let { GownTags(t.code, it) }
        }
        return GownDetail(g.id, g.name, attributes, photos, photos.size, g.createdAt, g.confidence, confidenceBand(g.confidence), g.description, g.version ?: 0)
    }

    /** Decrypted bytes and Content-Type of one Photo of [gownId]: a thumbnail is always a JPEG, an original keeps its sniffed type. */
    fun image(gownId: UUID, photoId: UUID, full: Boolean): Pair<ByteArray, String> {
        val photo = em.find(Photo::class.java, photoId)?.takeIf { it.gownId == gownId } ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val obj = em.find(StoredObject::class.java, if (full) photo.originalObjectId else photo.thumbObjectId) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        return vault.read(obj) to (if (full) photo.contentType else ImageType.JPEG.mime)
    }

    /** The requested ids that are really values of [type]. Asking only for ids that are not matches nothing, never everything. */
    private fun scoped(ids: List<UUID>, tags: Map<UUID, TaxonomyValue>, type: TaxonomyType): List<UUID> {
        val ok = ids.filter { tags[it]?.type == type }
        return if (ids.isNotEmpty() && ok.isEmpty()) listOf(NO_MATCH) else ok
    }

    private fun count(jpql: String, params: Map<String, Any>): Long {
        val q = em.createQuery(jpql, Long::class.javaObjectType)
        params.forEach { (k, v) -> q.setParameter(k, v) }
        return q.singleResult.toLong()
    }

    /** Cards for Gowns already chosen (search), in the order given. */
    @Transactional(readOnly = true)
    fun cardsOf(gowns: List<Gown>): List<GownCard> =
        cards(gowns, em.createQuery("select t from TaxonomyValue t", TaxonomyValue::class.java).resultList.associateBy { it.id })

    private fun cards(gowns: List<Gown>, tags: Map<UUID, TaxonomyValue>): List<GownCard> {
        if (gowns.isEmpty()) return emptyList()
        val ids = gowns.map { it.id }
        val attrs = em.createQuery("select a from GownAttribute a where a.gownId in :ids", GownAttribute::class.java)
            .setParameter("ids", ids).resultList.groupBy { it.gownId }
        val photos = em.createQuery("select p from Photo p where p.gownId in :ids", Photo::class.java)
            .setParameter("ids", ids).resultList.groupBy { it.gownId }
        fun labels(g: Gown, type: TaxonomyType) =
            attrs[g.id].orEmpty().mapNotNull { tags[it.taxonomyValueId] }.filter { it.type == type }.map { it.value }.sortedBy { it.lowercase() }
        return gowns.map { g ->
            val ps = photos[g.id].orEmpty().sortedWith(compareBy({ it.createdAt }, { it.id }))
            GownCard(g.id, g.name, labels(g, TaxonomyType.SILHOUETTE), labels(g, TaxonomyType.FABRIC), ps.size, ps.take(4).map { it.id }, g.createdAt, g.isNew)
        }
    }

    companion object {
        private val NO_MATCH = UUID(0, 0)

        /** Reads and checks the request at the trust boundary; every bad field is named in the 422. */
        fun filter(silhouette: List<UUID>?, fabric: List<UUID>?, days: Int?, before: Long?, limit: Int?): GownFilter {
            val bad = mutableListOf<FieldProblem>()
            if ((silhouette?.size ?: 0) > GalleryLimits.MAX_IDS) bad += FieldProblem("silhouette", "too_many")
            if ((fabric?.size ?: 0) > GalleryLimits.MAX_IDS) bad += FieldProblem("fabric", "too_many")
            if ((days ?: 0) !in GalleryLimits.DAYS) bad += FieldProblem("days", "invalid")
            if (before != null && before < 1) bad += FieldProblem("before", "invalid")
            if (limit != null && limit !in 1..GalleryLimits.MAX_LIMIT) bad += FieldProblem("limit", "invalid")
            if (bad.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, bad)
            return GownFilter(silhouette.orEmpty().distinct(), fabric.orEmpty().distinct(), days ?: 0, before, limit ?: GalleryLimits.DEFAULT_LIMIT)
        }
    }
}
