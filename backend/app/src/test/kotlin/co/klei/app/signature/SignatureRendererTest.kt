package co.klei.app.signature

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** The desktop passes the same file (`desktop/src/settings/signature.test.ts`). */
class SignatureRendererTest {
    private val fixture = Path.of("../../docs/fixtures/signature.json")

    @Test fun `every golden case renders as written`() {
        val cases = Json.parseToJsonElement(Files.readString(fixture)).jsonObject["cases"]!!.jsonArray
        assertTrue(cases.size >= 5)
        for (c in cases.map { it.jsonObject }) {
            fun s(k: String) = c[k]!!.jsonPrimitive.content
            val out = SignatureRenderer.render(c["enabled"]!!.jsonPrimitive.boolean, s("signoff"), s("name"), s("title"), s("phone"), s("studioName"), s("studioAddress"))
            assertEquals(s("expected"), out, s("case"))
        }
    }
}
