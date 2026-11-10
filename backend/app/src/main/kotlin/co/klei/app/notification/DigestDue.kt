package co.klei.app.notification

import java.time.DayOfWeek
import java.time.Duration
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.TemporalAdjusters

/** When a digest is due (Story 11.13): hourly an hour after the last; daily at 08:00 and weekly on Monday 08:00 in the User's zone. */
object DigestDue {
    private val EIGHT = LocalTime.of(8, 0)

    fun due(frequency: String, last: Instant, now: Instant, zone: ZoneId): Boolean = when (frequency) {
        "hourly" -> !now.isBefore(last.plus(Duration.ofHours(1)))
        "daily" -> slot(now, zone, weekly = false).isAfter(last)
        "weekly" -> slot(now, zone, weekly = true).isAfter(last)
        else -> false
    }

    /** The latest 08:00 (daily) or Monday 08:00 (weekly) that is not after [now]. */
    private fun slot(now: Instant, zone: ZoneId, weekly: Boolean): Instant {
        val day = now.atZone(zone).toLocalDate().let { if (weekly) it.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)) else it }
        val at = ZonedDateTime.of(day, EIGHT, zone).toInstant()
        return if (at.isAfter(now)) ZonedDateTime.of(day.minusDays(if (weekly) 7 else 1), EIGHT, zone).toInstant() else at
    }
}
