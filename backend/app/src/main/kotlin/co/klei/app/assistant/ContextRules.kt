package co.klei.app.assistant

/** Which parts of the studio's data a question needs. Keyword matching, no model call (FR-25, ADR-8). */
enum class Intent { SUMMARIZE, DRAFT, GOWNS }

object Routing {
    fun of(text: String): Set<Intent> {
        val t = text.lowercase()
        return buildSet {
            if ("summar" in t) add(Intent.SUMMARIZE)
            if (listOf("draft", "reply", "respond").any { it in t }) add(Intent.DRAFT)
            if (listOf("gown", "dress", "suggest", "recommend").any { it in t }) add(Intent.GOWNS)
        }
    }

    fun mentionsInquiries(text: String): Boolean = text.lowercase().let { "inquir" in it || "client" in it }
}

/** What may leave for the AI provider (FR-27): at most [MAX_ITEMS] items of at most [MAX_ITEM_BYTES] bytes, with email addresses removed. */
object ContextRules {
    const val MAX_ITEMS = 20
    const val MAX_ITEM_BYTES = 2048
    private val EMAIL = Regex("""(?U)[\w.+\-]+@[\w\-]+(?:\.[\w\-]+)+""")
    private val SPACE = Regex("\\s+")

    // shortcut: only well-formed addresses are removed; "name at host dot com" passes, add a stricter scrub if studios report it.
    fun clean(raw: String): String = cut(EMAIL.replace(raw, "[email removed]").replace(SPACE, " ").trim())

    /** The longest prefix that fits [MAX_ITEM_BYTES] in UTF-8, never splitting a character. */
    fun cut(s: String): String {
        var bytes = 0
        var i = 0
        val out = StringBuilder()
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val n = when { cp < 0x80 -> 1; cp < 0x800 -> 2; cp < 0x10000 -> 3; else -> 4 }
            if (bytes + n > MAX_ITEM_BYTES) break
            bytes += n
            out.appendCodePoint(cp)
            i += Character.charCount(cp)
        }
        return out.toString()
    }
}
