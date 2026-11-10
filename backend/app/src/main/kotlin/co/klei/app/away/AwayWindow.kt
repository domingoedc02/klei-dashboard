package co.klei.app.away

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** The closure window a moment falls in, or null when the studio is open. Pure: the caller passes the moment and the zone. */
object AwayWindow {
    val DAYS = listOf("mon", "tue", "wed", "thu", "fri", "sat", "sun")

    /**
     * The start of the closure window that holds [now], as an instant. Two moments in one window share it, so it is the key of "already sent".
     * Whole days and daily times are read on the wall clock of [zone]; a day that is 23 or 25 hours long is still one day.
     */
    fun start(s: AwaySchedule, now: Instant, zone: ZoneId): Instant? {
        val t = now.atZone(zone)
        val today = t.toLocalDate()
        return when (s.mode) {
            "once" -> {
                val first = LocalDate.parse(s.start ?: return null)
                val last = s.end?.let(LocalDate::parse) ?: first
                if (today in first..last) first.atStartOfDay(zone).toInstant() else null
            }
            "weekly" -> {
                val on = s.days.map(DAYS::indexOf).filter { it >= 0 }.toSet()
                if (today.dayOfWeek.ordinal !in on) return null
                // Always closed: one window, so one message per client.
                if (on.size == DAYS.size) return Instant.EPOCH
                // Saturday and Sunday are one closure, not two.
                var d = today
                while (d.minusDays(1).dayOfWeek.ordinal in on) d = d.minusDays(1)
                d.atStartOfDay(zone).toInstant()
            }
            "daily" -> {
                val from = LocalTime.parse(s.from ?: return null)
                val to = LocalTime.parse(s.to ?: return null)
                val clock = t.toLocalTime()
                val day = when {
                    from < to -> today.takeIf { clock >= from && clock < to }
                    from > to -> if (clock >= from) today else today.minusDays(1).takeIf { clock < to }
                    else -> null
                }
                day?.atTime(from)?.atZone(zone)?.toInstant()
            }
            else -> null
        }
    }
}
