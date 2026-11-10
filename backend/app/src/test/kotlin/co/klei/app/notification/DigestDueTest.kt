package co.klei.app.notification

import org.junit.jupiter.api.Test
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 11.13: when a digest is due. Pure, so every edge is a table row. */
class DigestDueTest {
    private fun at(s: String) = Instant.parse(s)
    private fun due(f: String, last: String, now: String, zone: ZoneId = ZoneOffset.UTC) = DigestDue.due(f, at(last), at(now), zone)

    @Test fun `hourly is due exactly one hour after the last digest`() {
        assertFalse(due("hourly", "2026-11-10T10:00:00Z", "2026-11-10T10:59:59Z"))
        assertTrue(due("hourly", "2026-11-10T10:00:00Z", "2026-11-10T11:00:00Z"))
    }

    @Test fun `daily is due at 08-00 in the zone, once per day`() {
        assertFalse(due("daily", "2026-11-09T08:00:00Z", "2026-11-10T07:59:59Z"))
        assertTrue(due("daily", "2026-11-09T08:00:00Z", "2026-11-10T08:00:00Z"))
        assertFalse(due("daily", "2026-11-10T08:00:00Z", "2026-11-10T20:00:00Z"), "already sent today")
        assertFalse(due("daily", "2026-11-10T09:00:00Z", "2026-11-11T07:59:00Z"), "a cursor started after 08:00 waits for tomorrow")
        assertTrue(due("daily", "2026-11-10T09:00:00Z", "2026-11-11T08:00:00Z"))
        assertTrue(due("daily", "2026-11-01T00:00:00Z", "2026-11-10T08:30:00Z"), "a missed day is still due")
    }

    @Test fun `weekly is due on Monday 08-00 only`() {
        assertEquals(DayOfWeek.MONDAY, LocalDate.of(2026, 11, 9).dayOfWeek)
        assertFalse(due("weekly", "2026-11-09T08:00:00Z", "2026-11-15T23:00:00Z"))
        assertTrue(due("weekly", "2026-11-09T08:00:00Z", "2026-11-16T08:00:00Z"))
        assertFalse(due("weekly", "2026-11-10T09:00:00Z", "2026-11-16T07:59:00Z"), "Tuesday cursor waits for the next Monday")
        assertFalse(due("weekly", "2026-11-09T08:00:00Z", "2026-11-09T20:00:00Z"))
    }

    @Test fun `the zone moves the slot`() {
        val tokyo = ZoneId.of("Asia/Tokyo")
        assertFalse(due("daily", "2026-11-09T23:00:00Z", "2026-11-10T22:59:00Z", tokyo))
        assertTrue(due("daily", "2026-11-09T23:00:00Z", "2026-11-10T23:00:00Z", tokyo))
        assertTrue(due("weekly", "2026-11-08T23:00:00Z", "2026-11-15T23:00:00Z", tokyo), "Monday 08:00 JST is Sunday 23:00 UTC")
    }

    @Test fun `daylight saving shifts the slot with the clock`() {
        val ny = ZoneId.of("America/New_York") // clocks go back on 2026-11-01: 08:00 is 12:00Z before, 13:00Z after
        assertFalse(due("daily", "2026-10-31T12:00:00Z", "2026-11-01T12:59:00Z", ny))
        assertTrue(due("daily", "2026-10-31T12:00:00Z", "2026-11-01T13:00:00Z", ny))
    }

    @Test fun `real-time, never and anything else are never due`() {
        listOf("realtime", "never", "monthly").forEach { assertFalse(due(it, "2020-01-01T00:00:00Z", "2026-11-10T08:00:00Z"), it) }
    }
}
