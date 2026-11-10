package co.klei.app.assistant

import co.klei.app.gown.Gown
import co.klei.app.gown.GownQueryService
import co.klei.app.inquiry.Client
import co.klei.app.inquiry.Direction
import co.klei.app.inquiry.HtmlSanitizer
import co.klei.app.inquiry.Inquiry
import co.klei.app.inquiry.Message
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import co.klei.crypto.Terms
import jakarta.persistence.EntityManager
import org.springframework.stereotype.Component
import java.util.UUID

/** [items] are the cleaned lines sent as context; [gowns] the Gowns among them (id to name), the only ones an answer may point at. */
class Context(val items: List<String>, val gowns: Map<UUID, String>)

/**
 * FR-25/FR-27: builds the context block from rows the caller may read. Reads only; the `assistant` package has no write path (architecture rule).
 * Run inside a read-only transaction.
 */
@Component
class ContextBuilder(private val em: EntityManager, private val bidx: BlindIndex, private val gownCards: GownQueryService) {

    fun build(text: String, openInquiry: UUID?, canSeeGowns: Boolean): Context {
        val intents = Routing.of(text)
        val items = mutableListOf<String>()
        val basis = StringBuilder(text)
        when {
            Intent.SUMMARIZE in intents -> newestNew(SUMMARY_ROWS).forEach { items += summaryLine(it) }
            openInquiry != null || Intent.DRAFT in intents -> {
                val inquiry = openInquiry?.let { em.find(Inquiry::class.java, it) } ?: newestNew(1).firstOrNull()
                if (inquiry != null) threadLines(inquiry, items, basis)
            }
            Routing.mentionsInquiries(text) -> {
                val hits = matching(text)
                (hits.ifEmpty { newestNew(FREE_ROWS) }).forEach { items += summaryLine(it) }
            }
        }
        val names = LinkedHashMap<UUID, String>()
        val wantsGowns = Intent.GOWNS in intents || "gown" in text.lowercase() || "dress" in text.lowercase()
        if (canSeeGowns && wantsGowns) gownLines(basis.toString(), items, names)
        return Context(items.take(ContextRules.MAX_ITEMS), names)
    }

    private fun newestNew(n: Int): List<Inquiry> =
        em.createQuery("select i from Inquiry i where i.statusBidx = :s order by i.seq desc", Inquiry::class.java)
            .setParameter("s", bidx.of(BidxDomain.INQUIRY_STATUS, "new")).setMaxResults(n).resultList

    private fun matching(text: String): List<Inquiry> {
        val words = Terms.of(text).take(MAX_WORDS)
        if (words.isEmpty()) return emptyList()
        return em.createQuery(
            "select i from Inquiry i where i.id in (select t.inquiryId from InquiryTerm t where t.termBidx in :w) order by i.seq desc",
            Inquiry::class.java,
        ).setParameter("w", words.map { bidx.of(BidxDomain.INQUIRY_TERM, it) }).setMaxResults(FREE_ROWS).resultList
    }

    private fun messages(inquiry: Inquiry, n: Int): List<Message> =
        em.createQuery("select m from Message m where m.inquiryId = :i order by m.seq desc", Message::class.java)
            .setParameter("i", inquiry.id).setMaxResults(n).resultList.reversed()

    private fun plain(m: Message) = if (m.direction == Direction.OUT) HtmlSanitizer.plain(m.body) else m.body

    private fun clientName(inquiry: Inquiry) = em.find(Client::class.java, inquiry.clientId)?.name.orEmpty()

    private fun summaryLine(inquiry: Inquiry): String {
        val latest = messages(inquiry, 1).firstOrNull()?.let { plain(it) }.orEmpty()
        return ContextRules.clean("Inquiry: client ${clientName(inquiry)}; subject ${inquiry.subject}; status ${inquiry.status.name.lowercase()}; last message ${inquiry.lastMessageAt.toString().take(10)}; text: $latest")
    }

    private fun threadLines(inquiry: Inquiry, out: MutableList<String>, basis: StringBuilder) {
        out += ContextRules.clean("Thread: client ${clientName(inquiry)}; subject ${inquiry.subject}; status ${inquiry.status.name.lowercase()}")
        for (m in messages(inquiry, THREAD_MESSAGES)) {
            val body = plain(m)
            out += ContextRules.clean("${if (m.direction == Direction.IN) "Client wrote" else "Studio replied"} ${m.createdAt.toString().take(10)}: $body")
            if (m.direction == Direction.IN) basis.append(' ').append(body)
        }
    }

    private fun gownLines(basis: String, out: MutableList<String>, names: MutableMap<UUID, String>) {
        val words = Terms.of(basis).take(MAX_WORDS)
        val hits = if (words.isEmpty()) emptyList() else
            em.createQuery("select g from Gown g where g.id in (select t.gownId from GownTerm t where t.termBidx in :w) order by g.seq desc", Gown::class.java)
                .setParameter("w", words.map { bidx.of(BidxDomain.GOWN_TERM, it) }).setMaxResults(GOWN_ROWS).resultList
        val rows = hits.ifEmpty { em.createQuery("select g from Gown g order by g.seq desc", Gown::class.java).setMaxResults(GOWN_ROWS).resultList }
        val cards = gownCards.cardsOf(rows).associateBy { it.id }
        for (g in rows) {
            val c = cards[g.id] ?: continue
            names[g.id] = g.name
            out += ContextRules.clean("Gown [gown:${g.id}] ${g.name}; silhouette ${c.silhouette.joinToString(", ")}; fabric ${c.fabric.joinToString(", ")}; ${g.description.orEmpty()}")
        }
    }

    companion object {
        private const val SUMMARY_ROWS = 15
        private const val FREE_ROWS = 10
        private const val GOWN_ROWS = 10
        private const val THREAD_MESSAGES = 6
        private const val MAX_WORDS = 12
    }
}
