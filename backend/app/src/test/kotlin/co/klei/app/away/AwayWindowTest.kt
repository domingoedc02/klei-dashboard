package co.klei.app.away

import org.junit.jupiter.api.Test
import java.time.Instant
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** FR-32: which closure window a moment falls in. Pure, so the clock is just an argument. */
class AwayWindowTest {
    private val ny = ZoneId.of("America/New_York")
    private val utc = ZoneId.of("UTC")
    private fun at(s: String) = Instant.parse(s)
    private fun start(s: AwaySchedule, now: String, zone: ZoneId = utc) = AwayWindow.start(s, at(now), zone)

    @Test fun `once covers whole days in the studio zone, first to last inclusive`() {
        val s = AwaySchedule(mode = "once", start = "2026-11-26", end = "2026-11-27")
        assertEquals(at("2026-11-26T05:00:00Z"), start(s, "2026-11-26T15:00:00Z", ny))
        assertEquals(at("2026-11-26T05:00:00Z"), start(s, "2026-11-28T04:59:00Z", ny))
        assertNull(start(s, "2026-11-28T05:00:00Z", ny))
        assertNull(start(s, "2026-11-26T04:59:00Z", ny))
    }

    @Test fun `once with no last day is a single day`() {
        val s = AwaySchedule(mode = "once", start = "2026-12-25")
        assertEquals(at("2026-12-25T00:00:00Z"), start(s, "2026-12-25T23:59:00Z"))
        assertNull(start(s, "2026-12-26T00:00:00Z"))
    }

    @Test fun `weekly closes on the chosen days and a run of days is one window`() {
        val s = AwaySchedule(mode = "weekly", days = listOf("sat", "sun"))
        val sat = at("2026-11-14T00:00:00Z")
        assertEquals(sat, start(s, "2026-11-14T10:00:00Z"))
        assertEquals(sat, start(s, "2026-11-15T22:00:00Z"))
        assertNull(start(s, "2026-11-16T00:00:00Z"))
        assertNull(start(s, "2026-11-11T12:00:00Z"))
    }

    @Test fun `weekly runs wrap over the end of the week and seven days is one window for ever`() {
        val s = AwaySchedule(mode = "weekly", days = listOf("sun", "mon"))
        assertEquals(at("2026-11-15T00:00:00Z"), start(s, "2026-11-16T12:00:00Z"))
        assertEquals(Instant.EPOCH, start(AwaySchedule(mode = "weekly", days = AwayWindow.DAYS), "2026-11-11T12:00:00Z"))
    }

    @Test fun `daily inside one day`() {
        val s = AwaySchedule(mode = "daily", from = "12:00", to = "13:00")
        assertEquals(at("2026-11-11T12:00:00Z"), start(s, "2026-11-11T12:30:00Z"))
        assertNull(start(s, "2026-11-11T13:00:00Z"))
        assertNull(start(s, "2026-11-11T11:59:00Z"))
    }

    @Test fun `daily that wraps midnight keeps one window from evening to morning`() {
        val s = AwaySchedule(mode = "daily", from = "18:00", to = "09:00")
        val evening = at("2026-11-11T18:00:00Z")
        assertEquals(evening, start(s, "2026-11-11T23:00:00Z"))
        assertEquals(evening, start(s, "2026-11-12T08:59:00Z"))
        assertNull(start(s, "2026-11-12T09:00:00Z"))
        assertNull(start(s, "2026-11-11T17:59:00Z"))
    }

    @Test fun `daily window survives the spring-forward night as one window`() {
        val s = AwaySchedule(mode = "daily", from = "22:00", to = "07:00")
        val evening = at("2026-03-08T03:00:00Z") // Mar 7, 22:00 EST
        assertEquals(evening, start(s, "2026-03-08T06:30:00Z", ny)) // 01:30 EST
        assertEquals(evening, start(s, "2026-03-08T10:30:00Z", ny)) // 06:30 EDT, an hour of the night is gone
        assertNull(start(s, "2026-03-08T11:00:00Z", ny)) // 07:00 EDT
    }

    @Test fun `a 23 hour and a 25 hour day are each one whole day`() {
        val spring = AwaySchedule(mode = "once", start = "2026-03-08")
        assertEquals(at("2026-03-08T05:00:00Z"), start(spring, "2026-03-09T03:59:00Z", ny))
        assertNull(start(spring, "2026-03-09T04:00:00Z", ny))
        val fall = AwaySchedule(mode = "weekly", days = listOf("sun"))
        assertEquals(at("2026-11-01T04:00:00Z"), start(fall, "2026-11-02T04:59:00Z", ny))
        assertNull(start(fall, "2026-11-02T05:00:00Z", ny))
    }

    @Test fun `an unknown mode or a missing field is never a window`() {
        assertNull(start(AwaySchedule(mode = "monthly"), "2026-11-11T12:00:00Z"))
        assertNull(start(AwaySchedule(mode = "once"), "2026-11-11T12:00:00Z"))
        assertNull(start(AwaySchedule(mode = "daily", from = null), "2026-11-11T12:00:00Z"))
    }
}
