package co.klei.app.inquiry

import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.jsoup.nodes.TextNode
import org.jsoup.safety.Safelist

/** FR-21: the one gate for Reply HTML. The desktop has a copy of this allow-list (`sanitize.ts`); both must pass `docs/fixtures/xss-payloads.json`. */
object HtmlSanitizer {
    private val OUT = Document.OutputSettings().prettyPrint(false)
    private val LIST = Safelist()
        .addTags("b", "i", "u", "strong", "em", "ul", "ol", "li", "a", "br", "div")
        .addAttributes("a", "href")
        .addProtocols("a", "href", "http", "https", "mailto")
        .addEnforcedAttribute("a", "rel", "noopener noreferrer")

    fun clean(html: String): String = Jsoup.clean(html, "", LIST, OUT)

    /** Text of already clean [html]: line breaks at `br`, block ends and list items. */
    fun plain(html: String): String {
        val doc = Jsoup.parseBodyFragment(html)
        doc.outputSettings(OUT)
        doc.select("li").forEach { it.prependChild(TextNode("- ")) }
        doc.select("div, li").forEach { it.appendChild(TextNode("\n")) }
        return doc.body().wholeText().replace(Regex("[ \\t]+\n"), "\n").replace(Regex("\n{3,}"), "\n\n").trim()
    }

    /** The Signature (plain text lines) as HTML under a blank line. Empty when there is no Signature. */
    fun signature(text: String): String =
        if (text.isBlank()) "" else "<div><br></div><div>" + text.lines().joinToString("<br>") { escape(it) } + "</div>"

    private fun escape(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
}
