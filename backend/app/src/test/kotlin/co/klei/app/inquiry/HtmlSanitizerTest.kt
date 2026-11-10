package co.klei.app.inquiry

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HtmlSanitizerTest {
    private val cases: JsonArray = Json.parseToJsonElement(Files.readString(Path.of("../../docs/fixtures/xss-payloads.json"))).jsonObject["cases"]!!.jsonArray

    @Test fun `every shared payload is cleaned`() {
        assertTrue(cases.size >= 12)
        for (c in cases.map { it as JsonObject }) {
            val name = c["name"]!!.jsonPrimitive.content
            val out = HtmlSanitizer.clean(c["input"]!!.jsonPrimitive.content)
            c["forbidden"]!!.jsonArray.map { it.jsonPrimitive.content }.forEach { assertTrue(!out.contains(it, ignoreCase = true), "$name: '$it' in $out") }
            c["kept"]!!.jsonArray.map { it.jsonPrimitive.content }.forEach { assertTrue(out.contains(it), "$name: '$it' missing in $out") }
        }
    }

    @Test fun `plain text keeps line breaks and list items`() {
        assertEquals("Hello\nthere\n- one\n- two", HtmlSanitizer.plain("<div>Hello<br>there</div><ul><li>one</li><li>two</li></ul>"))
    }

    @Test fun `signature is escaped and one line per row`() {
        val html = HtmlSanitizer.signature("Warm regards,\nAna <script>")
        assertTrue(html.contains("Warm regards,<br>Ana &lt;script&gt;"), html)
        assertEquals("", HtmlSanitizer.signature(" "))
    }
}
