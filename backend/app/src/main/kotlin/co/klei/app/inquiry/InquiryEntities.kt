package co.klei.app.inquiry

import co.klei.crypto.BidxDomain
import co.klei.crypto.BlindIndexed
import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import org.hibernate.annotations.OptimisticLock
import java.time.Instant
import java.util.UUID

/** Stored lower case; `status_bidx` is the HMAC of that word (architecture §4.2). */
enum class InquiryStatus { NEW, REPLIED, CLOSED }

/** A Message from the Client is `in`, a reply from staff is `out` (Story 7.3). */
enum class Direction { IN, OUT }

/** `pending` until the mail server answers; a `pending` Message older than five minutes may be retried like a `failed` one. */
enum class MailState { PENDING, SENT, FAILED }

/** A person who writes in, found by the HMAC of the email address (FR-19). */
@Entity
@Table(name = "client")
@EncryptedEntity("client")
class Client(@Id val id: UUID, name: String, email: String, createdAt: Instant) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("name") var name: String = name
    @Transient @Encrypted("email") var email: String = email
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt
    /** Story 7.2 reads these, Story 7.4 edits them. [weddingDate] is an ISO date (`2026-09-14`), [source] one of a fixed set. */
    @Transient @Encrypted("phone") var phone: String? = null
    @Transient @Encrypted("city") var city: String? = null
    @Transient @Encrypted("wedding_date") var weddingDate: String? = null
    @Transient @Encrypted("source") var source: String? = null
    @Transient @Encrypted("note") var note: String? = null

    internal var nameCt: ByteArray? = null
    internal var emailCt: ByteArray? = null
    internal var phoneCt: ByteArray? = null
    internal var cityCt: ByteArray? = null
    internal var weddingDateCt: ByteArray? = null
    internal var sourceCt: ByteArray? = null
    internal var noteCt: ByteArray? = null
    @BlindIndexed(BidxDomain.CLIENT_EMAIL, "email") internal var emailBidx: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
}

/** One conversation with a Client. `seq` is plaintext (OQ-2) and moves only through `InquiryStateService`. */
@Entity
@Table(name = "inquiry")
@EncryptedEntity("inquiry")
class Inquiry(
    @Id val id: UUID,
    @Column(name = "client_id") val clientId: UUID,
    @Column(name = "seq") var seq: Long,
    subject: String,
    preview: String,
    status: InquiryStatus,
    unread: Boolean,
    lastMessageAt: Instant,
) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("subject") var subject: String = subject
    @Transient @Encrypted("preview") var preview: String = preview
    @Transient @Encrypted("status") var status: InquiryStatus = status
    @Transient @Encrypted("unread") var unread: Boolean = unread
    @Transient @Encrypted("last_message_at") var lastMessageAt: Instant = lastMessageAt

    internal var subjectCt: ByteArray? = null
    internal var previewCt: ByteArray? = null
    internal var statusCt: ByteArray? = null
    @BlindIndexed(BidxDomain.INQUIRY_STATUS, "status") internal var statusBidx: ByteArray? = null
    /** Outside the version: opening an Inquiry must not stale a status change another User is about to send with `If-Match`. */
    @field:OptimisticLock(excluded = true) internal var unreadCt: ByteArray? = null
    @field:OptimisticLock(excluded = true) @BlindIndexed(BidxDomain.INQUIRY_UNREAD, "unread") internal var unreadBidx: ByteArray? = null
    internal var lastMessageAtCt: ByteArray? = null
}

/** One search word of an Inquiry (Client name and subject) as an HMAC (architecture §4.2). */
@Entity
@Table(name = "inquiry_term")
class InquiryTerm(
    @Id val id: UUID,
    @Column(name = "inquiry_id") val inquiryId: UUID,
    @Column(name = "term_bidx") val termBidx: ByteArray,
)

/** [authorUserId] is null for a Client's Message. [idemBidx] is set when the create call carried an `Idempotency-Key`. */
@Entity
@Table(name = "message")
@EncryptedEntity("message")
class Message(
    @Id val id: UUID,
    @Column(name = "inquiry_id") val inquiryId: UUID,
    @Column(name = "author_user_id") val authorUserId: UUID?,
    direction: Direction,
    body: String,
    @Column(name = "idem_bidx") val idemBidx: ByteArray?,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Transient @Encrypted("direction") var direction: Direction = direction
    @Transient @Encrypted("body") var body: String = body
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt

    /** Only for `out` Messages (Story 7.3): whether the mail server took the reply. Null on a Client's Message. */
    @Transient @Encrypted("mail_state") var mailState: MailState? = null
    @Transient @Encrypted("mail_at") var mailAt: Instant? = null

    internal var directionCt: ByteArray? = null
    internal var bodyCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
    internal var mailStateCt: ByteArray? = null
    internal var mailAtCt: ByteArray? = null

    /** Plaintext ordering key (OQ-2), assigned by the database and only ever read. */
    @Column(name = "seq", insertable = false, updatable = false) internal var seq: Long? = null
}

/** A file for the next Reply. [messageId] is null until that Reply is sent; the nightly sweep removes unsent ones after 24 hours. */
@Entity
@Table(name = "attachment")
@EncryptedEntity("attachment")
class Attachment(
    @Id val id: UUID,
    @Column(name = "inquiry_id") val inquiryId: UUID,
    @Column(name = "user_id") val userId: UUID?,
    @Column(name = "object_id") val objectId: UUID,
    @Column(name = "idem_bidx") val idemBidx: ByteArray?,
    name: String,
    size: Long,
    createdAt: Instant,
) : EncryptedEntityBase() {
    @Column(name = "message_id") var messageId: UUID? = null

    @Transient @Encrypted("name") var name: String = name
    @Transient @Encrypted("size") var size: Long = size
    @Transient @Encrypted("created_at") var createdAt: Instant = createdAt

    internal var nameCt: ByteArray? = null
    internal var sizeCt: ByteArray? = null
    internal var createdAtCt: ByteArray? = null
}

/** One unsent Reply per Inquiry per User, saved as the User types (FR-21). */
@Entity
@Table(name = "draft")
@EncryptedEntity("draft")
class Draft(
    @Id val id: UUID,
    @Column(name = "inquiry_id") val inquiryId: UUID,
    @Column(name = "user_id") val userId: UUID,
    body: String,
    updatedAt: Instant,
) : EncryptedEntityBase() {
    @Transient @Encrypted("body") var body: String = body
    @Transient @Encrypted("updated_at") var updatedAt: Instant = updatedAt

    internal var bodyCt: ByteArray? = null
    internal var updatedAtCt: ByteArray? = null
}
