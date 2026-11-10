package co.klei.app.inquiry

import java.time.Duration
import java.time.Instant

/** One Message of an Inquiry as the reply figure needs it. */
class Stamp(val direction: Direction, val at: Instant)

/** Mean first-reply time in seconds for the last 30 days and the 30 days before; null when that window has no answered Inquiry. */
class ReplyAverages(val currentSeconds: Long?, val previousSeconds: Long?)

/** FR-7 "Avg. reply time". Pure so the window rules are testable without a database. */
object ReplyTimes {
    private val WINDOW = Duration.ofDays(30)

    /** [threads] holds the Messages of each Inquiry. An Inquiry counts once it has an `OUT` Message at or after its first `IN`; its age is that first `IN`'s age. */
    fun average(threads: List<List<Stamp>>, now: Instant): ReplyAverages {
        val current = mutableListOf<Long>()
        val previous = mutableListOf<Long>()
        for (t in threads) {
            val first = t.filter { it.direction == Direction.IN }.minOfOrNull { it.at } ?: continue
            val reply = t.filter { it.direction == Direction.OUT && !it.at.isBefore(first) }.minOfOrNull { it.at } ?: continue
            val age = Duration.between(first, now)
            val seconds = Duration.between(first, reply).seconds
            when {
                age <= WINDOW -> current += seconds
                age <= WINDOW.multipliedBy(2) -> previous += seconds
            }
        }
        return ReplyAverages(current.takeIf { it.isNotEmpty() }?.average()?.toLong(), previous.takeIf { it.isNotEmpty() }?.average()?.toLong())
    }
}
