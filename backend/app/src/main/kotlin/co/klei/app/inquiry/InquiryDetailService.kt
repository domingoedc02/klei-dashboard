package co.klei.app.inquiry

import co.klei.app.identity.AppUser
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.time.Instant
import java.util.UUID

class DetailClient(val id: UUID, val name: String, val email: String)

/**
 * [author] is the sender's name for our replies (null when the User is gone) and null for the Client's own Messages.
 * A Client's [body] is plain text; a reply's is clean HTML (`html` true). [mailState] is `pending`, `sent` or `failed` for replies only.
 */
class DetailMessage(
    val id: UUID, val direction: String, val author: String?, val createdAt: Instant, val body: String,
    val html: Boolean, val mailState: String?, val attachments: List<AttachmentView>,
)

class InquiryDetail(
    val id: UUID,
    val subject: String,
    val status: String,
    val unread: Boolean,
    val client: DetailClient,
    val messages: List<DetailMessage>,
    val version: Long,
)

class ClientInquiry(val id: UUID, val subject: String, val preview: String, val lastMessageAt: Instant, val status: String)

class ClientDetail(
    val id: UUID,
    val name: String,
    val email: String,
    val phone: String?,
    val city: String?,
    val weddingDate: String?,
    val source: String?,
    val note: String?,
    val createdAt: Instant,
    val inquiries: List<ClientInquiry>,
    val version: Long,
)

/** FR-20 and FR-23: read a thread and a Client. Reading never writes; [markRead] is its own call (A3). */
@Service
class InquiryDetailService(private val em: EntityManager) {

    @Transactional(readOnly = true)
    fun detail(id: UUID): InquiryDetail {
        val i = em.find(Inquiry::class.java, id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        val c = em.find(Client::class.java, i.clientId)!!
        val msgs = em.createQuery("select m from Message m where m.inquiryId = :i order by m.seq", Message::class.java).setParameter("i", id).resultList
        return InquiryDetail(
            i.id, i.subject, i.status.name.lowercase(), i.unread, DetailClient(c.id, c.name, c.email), views(msgs), i.version ?: 0,
        )
    }

    /** One Message in the shape the thread uses; the answer of Reply and Retry. */
    @Transactional(readOnly = true)
    fun message(id: UUID): DetailMessage = views(listOf(em.find(Message::class.java, id) ?: throw ProblemException(ProblemCode.NOT_FOUND))).single()

    private fun views(msgs: List<Message>): List<DetailMessage> {
        val ids = msgs.mapNotNull { it.authorUserId }.distinct()
        val names = if (ids.isEmpty()) emptyMap() else
            em.createQuery("select u from AppUser u where u.id in :ids", AppUser::class.java).setParameter("ids", ids).resultList.associate { it.id to it.name }
        val outs = msgs.filter { it.direction == Direction.OUT }.map { it.id }
        val files = if (outs.isEmpty()) emptyMap() else
            em.createQuery("select a from Attachment a where a.messageId in :ids", Attachment::class.java).setParameter("ids", outs).resultList
                .sortedBy { it.createdAt }.groupBy({ it.messageId!! }, { AttachmentView(it.id, it.name, it.size) })
        return msgs.map {
            DetailMessage(
                it.id, it.direction.name.lowercase(), it.authorUserId?.let(names::get), it.createdAt, it.body,
                it.direction == Direction.OUT, it.mailState?.name?.lowercase(), files[it.id].orEmpty(),
            )
        }
    }

    /** Clears the flag for the whole Workspace; `seq` and the API version stay, a repeat changes nothing. */
    @Transactional
    fun markRead(id: UUID) {
        val i = em.find(Inquiry::class.java, id, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (i.unread) i.unread = false
    }

    @Transactional(readOnly = true)
    fun client(id: UUID): ClientDetail {
        val c = em.find(Client::class.java, id) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        // shortcut: newest 200 Inquiries of one Client, no paging; add a cursor if a Client ever passes that.
        val rows = em.createQuery("select i from Inquiry i where i.clientId = :c order by i.seq desc", Inquiry::class.java)
            .setParameter("c", id).setMaxResults(200).resultList
        return ClientDetail(
            c.id, c.name, c.email, c.phone, c.city, c.weddingDate, c.source, c.note, c.createdAt,
            rows.map { ClientInquiry(it.id, it.subject, it.preview, it.lastMessageAt, it.status.name.lowercase()) }, c.version ?: 0,
        )
    }
}
