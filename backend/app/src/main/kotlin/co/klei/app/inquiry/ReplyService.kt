package co.klei.app.inquiry

import co.klei.app.identity.AuditService
import co.klei.app.identity.UserService
import co.klei.app.signature.SignatureService
import co.klei.app.upload.ObjectVault
import co.klei.app.upload.StoredObject
import co.klei.app.web.FieldProblem
import co.klei.app.web.ProblemCode
import co.klei.app.web.ProblemException
import co.klei.core.audit.AuditAction
import co.klei.core.mail.MailAttachment
import co.klei.core.mail.MailPort
import co.klei.core.mail.ReplyMail
import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndex
import jakarta.persistence.EntityManager
import jakarta.persistence.LockModeType
import org.slf4j.LoggerFactory
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import java.time.Duration
import java.time.Instant
import java.util.HexFormat
import java.util.UUID

class Sent(val messageId: UUID, val created: Boolean)

/** What [ReplyService.deliver] needs once the transaction is closed; the file bodies are fetched after that. */
private class Outgoing(val to: String, val subject: String, val html: String, val files: List<Pair<String, StoredObject>>)

/**
 * FR-21: a Reply is recorded first and mailed second. The Message, the Replied status, the Draft removal and the Audit Entry
 * commit together; the mail goes out right after, and its outcome (`sent` or `failed`) is written to the Message.
 * A failed mail never undoes the Reply: the thread shows it and Retry sends the same Message again.
 */
@Service
class ReplyService(
    private val em: EntityManager,
    txm: PlatformTransactionManager,
    private val bidx: BlindIndex,
    private val state: InquiryStateService,
    private val signatures: SignatureService,
    private val users: UserService,
    private val audit: AuditService,
    private val vault: ObjectVault,
    private val mail: MailPort,
) {
    private val log = LoggerFactory.getLogger(ReplyService::class.java)
    private val tx = TransactionTemplate(txm)

    /** A repeated `Idempotency-Key` of one User returns the first Message and sends nothing more. */
    fun reply(inquiryId: UUID, userId: UUID, rawBody: String?, key: ByteArray, ip: String?): Sent {
        val html = check(rawBody)
        val idem = bidx.of(BidxDomain.IDEM, "reply|$userId|${HexFormat.of().formatHex(key)}")
        tx.execute { replay(idem, inquiryId) }?.let { return Sent(it, false) }
        val id = try {
            tx.execute { insert(inquiryId, userId, html, idem, ip) }!!
        } catch (e: DataIntegrityViolationException) {
            // A parallel call with the same key won the unique index: its Message is the answer.
            return Sent(tx.execute { replay(idem, inquiryId) } ?: throw e, false)
        }
        deliver(id)
        return Sent(id, true)
    }

    /** Only a `failed` Message, or a `pending` one whose attempt is older than five minutes (the server stopped midway). */
    fun retry(messageId: UUID): UUID {
        tx.executeWithoutResult {
            val m = em.find(Message::class.java, messageId, LockModeType.PESSIMISTIC_WRITE)?.takeIf { it.direction == Direction.OUT }
                ?: throw ProblemException(ProblemCode.NOT_FOUND)
            val stale = m.mailState == MailState.PENDING && (m.mailAt ?: m.createdAt).isBefore(Instant.now().minus(STALE))
            if (m.mailState != MailState.FAILED && !stale) throw ProblemException(ProblemCode.CONFLICT)
            m.mailState = MailState.PENDING
            m.mailAt = Instant.now()
        }
        deliver(messageId)
        return messageId
    }

    private fun check(raw: String?): String {
        val text = raw.orEmpty()
        if (text.length > ReplyLimits.MAX_DRAFT) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("body", "too_long")))
        val clean = HtmlSanitizer.clean(text)
        if (HtmlSanitizer.plain(clean).isBlank()) throw ProblemException(ProblemCode.VALIDATION_FAILED, listOf(FieldProblem("body", "required")))
        return clean
    }

    private fun replay(idem: ByteArray, inquiryId: UUID): UUID? {
        val m = em.createQuery("select m from Message m where m.idemBidx = :i", Message::class.java).setParameter("i", idem).resultList.firstOrNull() ?: return null
        if (m.inquiryId != inquiryId) throw ProblemException(ProblemCode.CONFLICT)
        return m.id
    }

    private fun insert(inquiryId: UUID, userId: UUID, html: String, idem: ByteArray, ip: String?): UUID {
        val inquiry = em.find(Inquiry::class.java, inquiryId, LockModeType.PESSIMISTIC_WRITE) ?: throw ProblemException(ProblemCode.NOT_FOUND)
        if (inquiry.status == InquiryStatus.CLOSED) throw ProblemException(ProblemCode.CONFLICT)
        val now = Instant.now()
        val body = html + HtmlSanitizer.signature(signatures.get(userId).preview)
        val m = Message(UUID.randomUUID(), inquiryId, userId, Direction.OUT, body, idem, now)
        m.mailState = MailState.PENDING
        em.persist(m)
        em.flush()
        em.createQuery("select a from Attachment a where a.inquiryId = :i and a.userId = :u and a.messageId is null", Attachment::class.java)
            .setParameter("i", inquiryId).setParameter("u", userId).resultList.forEach { it.messageId = m.id }
        em.createQuery("select d from Draft d where d.inquiryId = :i and d.userId = :u", Draft::class.java)
            .setParameter("i", inquiryId).setParameter("u", userId).resultList.forEach(em::remove)
        state.setStatus(inquiry, InquiryStatus.REPLIED)
        inquiry.unread = false
        inquiry.lastMessageAt = now
        inquiry.preview = InquiryService.preview(HtmlSanitizer.plain(html))
        state.touch(inquiry)
        audit.record(AuditAction.REPLY_SENT, null, userId, users.get(userId)?.name ?: "unknown", ip)
        em.flush()
        return m.id
    }

    /** Sends the Message and writes the outcome. Never throws: a failure is `failed` on the Message, class name only in the log. */
    private fun deliver(id: UUID) {
        val ok = try {
            val out = tx.execute { prepare(id) }!!
            val files = out.files.map { (name, o) -> MailAttachment(name, vault.read(o)) }
            mail.sendReply(ReplyMail(out.to, out.subject, page(out.html), HtmlSanitizer.plain(out.html), files))
        } catch (e: Exception) {
            log.warn("reply {} not mailed: {}", id, e.javaClass.simpleName)
            false
        }
        tx.executeWithoutResult {
            val m = em.find(Message::class.java, id, LockModeType.PESSIMISTIC_WRITE)!!
            m.mailState = if (ok) MailState.SENT else MailState.FAILED
            m.mailAt = Instant.now()
        }
    }

    private fun prepare(id: UUID): Outgoing {
        val m = em.find(Message::class.java, id)!!
        val i = em.find(Inquiry::class.java, m.inquiryId)!!
        val c = em.find(Client::class.java, i.clientId)!!
        val files = em.createQuery("select a from Attachment a where a.messageId = :m", Attachment::class.java).setParameter("m", id).resultList
            .sortedBy { it.createdAt }.map { it.name to em.find(StoredObject::class.java, it.objectId)!! }
        return Outgoing(c.email, i.subject, m.body, files)
    }

    private fun page(fragment: String) = "<!doctype html><html><body>$fragment</body></html>"

    companion object { val STALE: Duration = Duration.ofMinutes(5) }
}
