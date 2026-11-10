package co.klei.app.assistant

import java.util.UUID

/** [text] has every Gown token replaced by the Gown's name; [ids] are the Gowns it really named, once each, in order. */
class Guarded(val text: String, val ids: List<UUID>)

/**
 * FR-25: the model may only point at Gowns the context offered. It writes `[gown:<id>]`; a token whose id is not in the offered
 * set is removed, so no invented or foreign Gown reaches the screen. A name written without a token is plain prose and links to nothing.
 */
object GownNameGuard {
    private val TOKEN = Regex("""\[gown:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})]""")

    fun referenced(answer: String): Set<UUID> = TOKEN.findAll(answer).mapNotNull { runCatching { UUID.fromString(it.groupValues[1]) }.getOrNull() }.toSet()

    /** [names] is the offered Gowns that still exist, by id. */
    fun apply(answer: String, names: Map<UUID, String>): Guarded {
        val ids = LinkedHashSet<UUID>()
        val text = TOKEN.replace(answer) { m ->
            val id = runCatching { UUID.fromString(m.groupValues[1]) }.getOrNull()
            val name = id?.let { names[it] }
            if (name == null) "" else { ids += id; name }
        }.replace(Regex("[ \\t]{2,}"), " ").trim()
        return Guarded(text, ids.toList())
    }
}
