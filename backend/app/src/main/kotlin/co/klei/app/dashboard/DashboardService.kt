package co.klei.app.dashboard

import co.klei.app.gown.GownCard
import co.klei.app.gown.GownFilter
import co.klei.app.gown.GownQueryService
import co.klei.app.inquiry.InquiryFilter
import co.klei.app.inquiry.InquiryItem
import co.klei.app.inquiry.InquiryService
import co.klei.app.inquiry.InquiryStatus
import co.klei.app.inquiry.ReplyAverages
import co.klei.app.upload.BatchPhase
import co.klei.app.upload.GroupingService
import co.klei.app.upload.UploadBatchService
import com.fasterxml.jackson.annotation.JsonInclude
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service
import java.time.Instant
import java.util.UUID

/**
 * [phase] is `idle`, `processing`, `review` or `error`; [step], [done] and [total] appear only while processing,
 * [groups] and [lowConfidence] (groups under 80) only in review.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class AiStatusView(val phase: String, val step: Int?, val done: Int?, val total: Int?, val groups: Int? = null, val lowConfidence: Int? = null)

/** [unread] is the sidebar badge number; [latest] the newest New Inquiries, only fetched when something is unread. [oldestUnreadAt] is the oldest unread New Inquiry's last message. */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class InquiryWidget(val unread: Long, val latest: List<InquiryItem>, val oldestUnreadAt: Instant? = null)

/**
 * FR-7. A field is absent when the caller's Role may not see it. [photosThisMonth] and [gownsThisMonth] count this UTC month's saved Gowns;
 * [avgReplySeconds] and [prevAvgReplySeconds] are the mean first-reply time of the last 30 days and the 30 before (absent without answered Inquiries). [errors] names the widgets (`recent`, `total`, `inquiries`, `ai`)
 * whose data failed, so one bad read shows one error block and the rest still render.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
data class DashboardView(
    val recentGowns: List<GownCard>?,
    val totalGowns: Long?,
    val newThisWeek: Long?,
    val photosThisMonth: Long?,
    val gownsThisMonth: Long?,
    val aiStatus: AiStatusView?,
    val inquiries: InquiryWidget?,
    val avgReplySeconds: Long?,
    val prevAvgReplySeconds: Long?,
    val errors: List<String>,
)

/**
 * Not transactional itself: every read below runs in its own transaction, so a failure in one cannot mark the others rollback-only.
 * Only the exception class is logged, never its message (it can carry row text).
 */
@Service
class DashboardService(
    private val gowns: GownQueryService,
    private val inquiries: InquiryService,
    private val batches: UploadBatchService,
    private val grouping: GroupingService,
) {
    private val log = LoggerFactory.getLogger(DashboardService::class.java)

    fun view(userId: UUID, withGowns: Boolean, withInquiries: Boolean): DashboardView {
        val errors = mutableListOf<String>()
        fun <T> guard(vararg widgets: String, read: () -> T): T? = try {
            read()
        } catch (e: RuntimeException) {
            log.warn("dashboard widget failed widgets={} type={}", widgets.joinToString(","), e.javaClass.name)
            errors += widgets
            null
        }

        val page = if (withGowns) guard("recent", "total") { gowns.query(GownFilter(emptyList(), emptyList(), 0, null, RECENT)) } else null
        val week = if (page != null) guard("total") { gowns.query(GownFilter(emptyList(), emptyList(), 7, null, 1)).matching } else null
        val now = Instant.now()
        val month = if (page != null) guard("total") { gowns.monthStats(now) } else null
        var reply: ReplyAverages? = null
        val inbox = if (withInquiries) guard("inquiries") {
            val unread = inquiries.count().count
            val latest = if (unread > 0) inquiries.query(InquiryFilter(InquiryStatus.NEW, null, LATEST)).items else emptyList()
            reply = inquiries.replyTimes(now)
            InquiryWidget(unread, latest, if (unread > 0) inquiries.oldestUnread() else null)
        } else null
        val ai = guard("ai") { aiOf(userId) }
        return DashboardView(
            page?.items, page?.total?.takeIf { week != null }, week, month?.photos, month?.gowns, ai, inbox,
            reply?.currentSeconds, reply?.previousSeconds,
            errors.distinct(),
        )
    }

    /** Processing reads the progress map and Review the group confidences of the one batch; Error is just its phase. */
    private fun aiOf(userId: UUID): AiStatusView {
        val b = batches.peek(userId)
        return when (b?.phase) {
            null, BatchPhase.EMPTY -> IDLE
            BatchPhase.PROCESSING -> grouping.status(userId, b.id).let { AiStatusView("processing", it.step, it.done, it.total) }
            BatchPhase.REVIEW -> grouping.status(userId, b.id).groups.orEmpty().let { g -> AiStatusView("review", null, null, null, g.size, g.count { it.band == "low" }) }
            else -> AiStatusView(b.phase.name.lowercase(), null, null, null)
        }
    }

    companion object {
        const val RECENT = 5
        const val LATEST = 3
        private val IDLE = AiStatusView("idle", null, null, null)
    }
}
