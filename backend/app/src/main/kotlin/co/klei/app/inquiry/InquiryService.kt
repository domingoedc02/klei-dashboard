package co.klei.app.inquiry

import co.klei.app.away.AwayService
import co.klei.app.identity.AppUser
import co.klei.app.identity.RoleService
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.identity.Permission
import co.klei.core.identity.UserStatus
import co.klei.core.notification.NotificationPort
import co.klei.core.notification.NotificationType
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import jakarta.persistence.EntityManager
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate
import java.time.Instant
import java.util.HexFormat
import java.util.UUID

class NewInquiry(val clientName: String, val clientEmail: String, val subject: String, val body: String)

/** One row of the Inbox. `next` of a page is the `seq` to ask `before` of; it is a cursor, never a watermark (architecture §4.4). */
data class InquiryItem(
    val id: UUID,
    val clientId: UUID,
    val clientName: String,
    val subject: String,
    val preview: String,
    val lastMessageAt: Instant,
    val status: String,
    val unread: Boolean,
)

data class InquiryPage(val items: List<InquiryItem>, val next: Long?)
data class InquiryCount(val count: Long)
class Created(val item: InquiryItem, val created: Boolean)

object InquiryLimits {
    const val DEFAULT_LIMIT = 25
    const val MAX_LIMIT = 50
    const val MAX_NAME = 80
    const val MAX_EMAIL = 254
    const val MAX_SUBJECT = 200
    const val MAX_BODY = 20_000
    const val PREVIEW = 120
}

/** FR-19 and FR-24: create and list. Everything the database sees is a ciphertext, an HMAC, an id or `seq`. */
@Service
class InquiryService(
    private val em: EntityManager,
    private val bidx: BlindIndex,
    private val clients: ClientMatcher,
    private val state: InquiryStateService,
    private val terms: InquiryTermIndexer,
    private val roles: RoleService,
    private val notifier: NotificationPort,
    private val away: AwayService,
    txm: PlatformTransactionManager,
) {
    private val tx = TransactionTemplate(txm)

    /** A repeated `Idempotency-Key` from the same User returns the Inquiry it made the first time. */
    fun create(input: NewInquiry, userId: UUID, key: ByteArray?): Created {
        val idem = key?.let { bidx.of(BidxDomain.IDEM, "$userId|${HexFormat.of().formatHex(it)}") }
        if (idem != null) tx.execute { replay(idem) }?.let { return Created(it, false) }
        val made = try {
            Created(tx.execute { insert(input, userId, idem) }!!, true)
        } catch (e: DataIntegrityViolationException) {
            // A parallel call with the same key or a first contact from the same address won the race; one retry sees its row.
            idem?.let { k -> tx.execute { replay(k) } }?.let { return Created(it, false) }
            Created(tx.execute { insert(input, userId, idem) }!!, true)
        }
        // After the commit and never in reply to a reply (FR-32); the call cannot fail the inquiry.
        away.onInquiry(made.item.clientId)
        return made
    }

    private fun replay(idem: ByteArray): InquiryItem? {
        val m = em.createQuery("select m from Message m where m.idemBidx = :i", Message::class.java).setParameter("i", idem).resultList.firstOrNull() ?: return null
        val inquiry = em.find(Inquiry::class.java, m.inquiryId) ?: return null
        return item(inquiry, em.find(Client::class.java, inquiry.clientId)!!)
    }

    private fun insert(i: NewInquiry, userId: UUID, idem: ByteArray?): InquiryItem {
        val now = Instant.now()
        val client = clients.match(i.clientName, i.clientEmail, now)
        em.flush()
        val inquiry = Inquiry(UUID.randomUUID(), client.id, state.nextSeq(), i.subject, preview(i.body), InquiryStatus.NEW, true, now)
        em.persist(inquiry)
        em.flush()
        em.persist(Message(UUID.randomUUID(), inquiry.id, null, Direction.IN, i.body, idem, now))
        terms.index(inquiry.id, client.name, i.subject)
        notifier.notify(NotificationType.NEW_INQUIRY, recipients(userId), "New inquiry from ${client.name}", "inquiries/${inquiry.id}")
        em.flush()
        return item(inquiry, client)
    }

    /** Active Users whose Role may reply and who have not switched "New inquiry" off (FR-34); the User who entered it is not told about it. */
    private fun recipients(except: UUID): List<UUID> {
        val replyRoles = roles.roles().filter { Permission.PERM_REPLY in roles.permissions(it.id) }.map { it.id }
        if (replyRoles.isEmpty()) return emptyList()
        return em.createQuery("select u from AppUser u where u.roleId in :r", AppUser::class.java).setParameter("r", replyRoles).resultList
            .filter { it.id != except && it.status == UserStatus.ACTIVE && it.prefs?.newInquiry != false }.map { it.id }
    }

    @Transactional(readOnly = true)
    fun query(f: InquiryFilter): InquiryPage {
        val clauses = mutableListOf<String>()
        if (f.status != null) clauses += "i.statusBidx = :s"
        if (f.before != null) clauses += "i.seq < :before"
        val q = em.createQuery("select i from Inquiry i" + (if (clauses.isEmpty()) "" else clauses.joinToString(" and ", " where ")) + " order by i.seq desc", Inquiry::class.java)
        if (f.status != null) q.setParameter("s", bidx.of(BidxDomain.INQUIRY_STATUS, f.status.name.lowercase()))
        if (f.before != null) q.setParameter("before", f.before)
        val rows = q.setMaxResults(f.limit + 1).resultList
        val page = rows.take(f.limit)
        val names = if (page.isEmpty()) emptyMap() else
            em.createQuery("select c from Client c where c.id in :ids", Client::class.java).setParameter("ids", page.map { it.clientId }.distinct()).resultList.associateBy { it.id }
        return InquiryPage(page.map { item(it, names.getValue(it.clientId)) }, if (rows.size > f.limit) page.last().seq else null)
    }

    /** The sidebar badge: Inquiries that are New and unread, counted through two HMACs without decrypting a row. */
    @Transactional(readOnly = true)
    fun count(): InquiryCount = InquiryCount(
        em.createQuery("select count(i) from Inquiry i where i.statusBidx = :s and i.unreadBidx = :u", Long::class.javaObjectType)
            .setParameter("s", bidx.of(BidxDomain.INQUIRY_STATUS, "new")).setParameter("u", bidx.of(BidxDomain.INQUIRY_UNREAD, "1")).singleResult,
    )

    /** When the oldest New unread Inquiry last heard from its Client, or null when none: the lowest `seq` among the two blind-index matches. */
    @Transactional(readOnly = true)
    fun oldestUnread(): Instant? =
        em.createQuery("select i from Inquiry i where i.statusBidx = :s and i.unreadBidx = :u order by i.seq asc", Inquiry::class.java)
            .setParameter("s", bidx.of(BidxDomain.INQUIRY_STATUS, "new")).setParameter("u", bidx.of(BidxDomain.INQUIRY_UNREAD, "1"))
            .setMaxResults(1).resultList.firstOrNull()?.lastMessageAt

    /**
     * Mean first-reply time over the newest [REPLY_SAMPLE] Inquiries. Message times are ciphertext, so they are read and decrypted here, never ranged in SQL.
     * shortcut: 100 newest Inquiries only, add a cached daily figure if a studio gets more than 100 Inquiries per 60 days.
     */
    @Transactional(readOnly = true)
    fun replyTimes(now: Instant): ReplyAverages {
        val ids = em.createQuery("select i.id from Inquiry i order by i.seq desc", UUID::class.java).setMaxResults(REPLY_SAMPLE).resultList
        if (ids.isEmpty()) return ReplyAverages(null, null)
        val byInquiry = em.createQuery("select m from Message m where m.inquiryId in :ids", Message::class.java).setParameter("ids", ids).resultList
            .groupBy({ it.inquiryId }, { Stamp(it.direction, it.createdAt) })
        return ReplyTimes.average(byInquiry.values.toList(), now)
    }

    private fun item(i: Inquiry, c: Client) = InquiryItem(i.id, c.id, c.name, i.subject, i.preview, i.lastMessageAt, i.status.name.lowercase(), i.unread)

    companion object {
        const val REPLY_SAMPLE = 100

        private val EMAIL = Regex("[^@\\s]+@[^@\\s]+\\.[^@\\s]+")
        private val BLANKS = Regex("\\s+")

        fun clean(clientName: String?, clientEmail: String?, subject: String?, body: String?): NewInquiry {
            val bad = mutableListOf<FieldProblem>()
            val name = line("clientName", clientName, InquiryLimits.MAX_NAME, bad)
            val email = clientEmail?.trim().orEmpty()
            if (email.isEmpty()) bad += FieldProblem("clientEmail", "required")
            else if (email.length > InquiryLimits.MAX_EMAIL || !EMAIL.matches(email)) bad += FieldProblem("clientEmail", "invalid")
            val subj = line("subject", subject, InquiryLimits.MAX_SUBJECT, bad)
            val text = body?.trim().orEmpty()
            if (text.isEmpty()) bad += FieldProblem("body", "required")
            else if (text.length > InquiryLimits.MAX_BODY) bad += FieldProblem("body", "too_long")
            if (bad.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, bad)
            return NewInquiry(name, email, subj, text)
        }

        private fun line(field: String, raw: String?, max: Int, bad: MutableList<FieldProblem>): String {
            val v = raw?.replace(BLANKS, " ")?.trim().orEmpty()
            if (v.isEmpty()) bad += FieldProblem(field, "required") else if (v.length > max) bad += FieldProblem(field, "too_long")
            return v
        }

        /** The first 120 characters with line breaks folded into spaces; never ends inside a surrogate pair. */
        fun preview(body: String): String {
            val flat = body.replace(BLANKS, " ").trim()
            if (flat.length <= InquiryLimits.PREVIEW) return flat
            val cut = if (flat[InquiryLimits.PREVIEW - 1].isHighSurrogate()) InquiryLimits.PREVIEW - 1 else InquiryLimits.PREVIEW
            return flat.substring(0, cut)
        }

        fun filter(status: String?, before: Long?, limit: Int?): InquiryFilter {
            val bad = mutableListOf<FieldProblem>()
            val s = status?.let { w -> InquiryStatus.entries.firstOrNull { it.name.lowercase() == w } ?: run { bad += FieldProblem("status", "invalid"); null } }
            if (before != null && before < 1) bad += FieldProblem("before", "invalid")
            if (limit != null && limit !in 1..InquiryLimits.MAX_LIMIT) bad += FieldProblem("limit", "invalid")
            if (bad.isNotEmpty()) throw ProblemException(ProblemCode.VALIDATION_FAILED, bad)
            return InquiryFilter(s, before, limit ?: InquiryLimits.DEFAULT_LIMIT)
        }
    }
}

class InquiryFilter(val status: InquiryStatus?, val before: Long?, val limit: Int)
