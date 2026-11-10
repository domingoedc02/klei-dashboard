package co.klei.app.inquiry

import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Service

/**
 * The only writer of `inquiry.seq` and `inquiry.status` (architecture §4.3): a new Message moves its Inquiry to a fresh `nextval`,
 * so newest activity sorts first. A status change alone is not activity and leaves `seq` where it was.
 */
@Service
class InquiryStateService(private val jdbc: JdbcTemplate) {
    fun nextSeq(): Long = jdbc.queryForObject("select nextval('inquiry_activity_seq')", Long::class.java)!!

    fun touch(inquiry: Inquiry) {
        inquiry.seq = nextSeq()
    }

    fun setStatus(inquiry: Inquiry, status: InquiryStatus) {
        inquiry.status = status
    }

    /** AD-21: a Client's Message is unread and newest; on a Closed Inquiry it also reopens it. No intake calls this yet. */
    fun reopenOnClientMessage(inquiry: Inquiry) {
        if (inquiry.status == InquiryStatus.CLOSED) setStatus(inquiry, InquiryStatus.NEW)
        inquiry.unread = true
        touch(inquiry)
    }
}
