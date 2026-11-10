package co.klei.app.search

import co.klei.app.gown.Gown
import co.klei.app.gown.GownQueryService
import co.klei.app.inquiry.Client
import co.klei.app.inquiry.Inquiry
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.Terms
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.UUID

/** [kind] is `gown` or `inquiry`. A Gown shows its [subtitle] as "Silhouette, Fabric" and up to four [thumbs]; an Inquiry shows client name and subject. */
class SearchHit(val kind: String, val id: UUID, val title: String, val subtitle: String, val thumbs: List<UUID>)
class SearchResult(val items: List<SearchHit>)

/**
 * FR-28: whole-word search over the blind term indexes (architecture §4.2). The words are hashed here and only the HMACs reach SQL;
 * nothing is decrypted except the few rows that are returned. The words are never logged.
 */
@Service
class SearchService(private val em: EntityManager, private val bidx: BlindIndex, private val gowns: GownQueryService) {

    @Transactional(readOnly = true)
    fun search(q: String?, withGowns: Boolean, withInquiries: Boolean): SearchResult {
        if (q == null) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("q", "required")))
        if (q.length > MAX_Q) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("q", "too_long")))
        val words = Terms.of(q).take(MAX_WORDS)
        if (words.isEmpty()) return SearchResult(emptyList())
        val hits = mutableListOf<SearchHit>()
        if (withGowns) hits += gownHits(words)
        if (withInquiries && hits.size < LIMIT) hits += inquiryHits(words, LIMIT - hits.size)
        return SearchResult(hits)
    }

    private fun gownHits(words: List<String>): List<SearchHit> {
        val rows = em.createQuery(
            "select g from Gown g where g.id in (select t.gownId from GownTerm t where t.termBidx in :w group by t.gownId having count(distinct t.termBidx) = :n) order by g.seq desc",
            Gown::class.java,
        ).setParameter("w", words.map { bidx.of(BidxDomain.GOWN_TERM, it) }).setParameter("n", words.size.toLong()).setMaxResults(LIMIT).resultList
        return gowns.cardsOf(rows).map { SearchHit("gown", it.id, it.name, (it.silhouette + it.fabric).joinToString(", "), it.thumbs) }
    }

    private fun inquiryHits(words: List<String>, room: Int): List<SearchHit> {
        val rows = em.createQuery(
            "select i from Inquiry i where i.id in (select t.inquiryId from InquiryTerm t where t.termBidx in :w group by t.inquiryId having count(distinct t.termBidx) = :n) order by i.seq desc",
            Inquiry::class.java,
        ).setParameter("w", words.map { bidx.of(BidxDomain.INQUIRY_TERM, it) }).setParameter("n", words.size.toLong()).setMaxResults(room).resultList
        if (rows.isEmpty()) return emptyList()
        val names = em.createQuery("select c from Client c where c.id in :ids", Client::class.java)
            .setParameter("ids", rows.map { it.clientId }.distinct()).resultList.associate { it.id to it.name }
        return rows.map { SearchHit("inquiry", it.id, names[it.clientId].orEmpty(), it.subject, emptyList()) }
    }

    companion object {
        const val LIMIT = 6
        const val MAX_WORDS = 8
        const val MAX_Q = 200
    }
}
