package co.klei.app.inquiry

import org.junit.jupiter.api.Test
import java.time.Duration
import java.time.Instant
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ReplyTimesTest {
    private val now = Instant.parse("2026-11-10T12:00:00Z")
    private fun ago(days: Long, hours: Long = 0) = now.minus(Duration.ofDays(days)).minus(Duration.ofHours(hours))
    private fun thread(inAt: Instant, replyAfterHours: Long?) = listOfNotNull(
        Stamp(Direction.IN, inAt),
        replyAfterHours?.let { Stamp(Direction.OUT, inAt.plus(Duration.ofHours(it))) },
    )

    @Test fun `unanswered Inquiries are skipped`() {
        val r = ReplyTimes.average(listOf(thread(ago(2), null), thread(ago(3), 2)), now)
        assertEquals(7200, r.currentSeconds)
    }

    @Test fun `a reply before the first message is ignored`() {
        val early = listOf(Stamp(Direction.OUT, ago(5)), Stamp(Direction.IN, ago(4)))
        assertNull(ReplyTimes.average(listOf(early), now).currentSeconds)
        val later = early + Stamp(Direction.OUT, ago(4).plus(Duration.ofHours(1)))
        assertEquals(3600, ReplyTimes.average(listOf(later), now).currentSeconds)
    }

    @Test fun `rows older than 60 days are ignored`() {
        val r = ReplyTimes.average(listOf(thread(ago(61), 1), thread(ago(90), 5)), now)
        assertNull(r.currentSeconds)
        assertNull(r.previousSeconds)
    }

    @Test fun `both windows are averaged apart`() {
        val r = ReplyTimes.average(
            listOf(thread(ago(1), 2), thread(ago(10), 4), thread(ago(31), 1), thread(ago(59), 3), thread(ago(30, 1), 6)),
            now,
        )
        assertEquals(3 * 3600, r.currentSeconds)
        assertEquals((1 + 3 + 6) * 3600 / 3, r.previousSeconds)
    }

    @Test fun `an empty window returns null`() {
        val r = ReplyTimes.average(listOf(thread(ago(40), 2)), now)
        assertNull(r.currentSeconds)
        assertEquals(7200, r.previousSeconds)
        assertNull(ReplyTimes.average(emptyList(), now).previousSeconds)
    }
}
