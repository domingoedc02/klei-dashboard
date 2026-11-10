package co.klei.app.ai

import co.klei.core.ai.AiProviderException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class PartitionParserTest {
    private fun completion(content: String) =
        kotlinx.serialization.json.JsonObject(mapOf("choices" to kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonObject(mapOf("message" to kotlinx.serialization.json.JsonObject(mapOf("content" to kotlinx.serialization.json.JsonPrimitive(content))))))))).toString()

    private fun parse(content: String, n: Int) = PromptBuilder.parsePartition(completion(content), n)

    @Test fun `one list is one gown, a split gives zero-based ascending parts ordered by first photo`() {
        assertEquals(listOf(listOf(0, 1, 2)), parse("""{"groups":[[1,2,3]]}""", 3))
        assertEquals(listOf(listOf(0, 2), listOf(1, 3)), parse("""{"groups":[[4,2],[3,1]]}""", 4))
    }

    @Test fun `code fences, chatter and string numbers are tolerated`() {
        assertEquals(listOf(listOf(0), listOf(1)), parse("Sure:\n```json\n{\"groups\": [[\"1\"], [\"2\"]]}\n```", 2))
    }

    @Test fun `a photo twice, missing, out of range, an empty part or the wrong shape is a bad response`() {
        for ((content, n) in listOf(
            """{"groups":[[1,2],[2,3]]}""" to 3, """{"groups":[[1]]}""" to 2, """{"groups":[[1,2,3]]}""" to 2, """{"groups":[[0,1]]}""" to 2,
            """{"groups":[[1,2],[]]}""" to 2, """{"groups":[1,2]}""" to 2, """{"groups":"1,2"}""" to 2, """{"other":[[1,2]]}""" to 2, """{"groups":[["a"]]}""" to 1, "no json" to 1,
        )) assertFailsWith<AiProviderException>(content) { parse(content, n) }
        assertFailsWith<AiProviderException> { PromptBuilder.parsePartition("""{"choices":[]}""", 1) }
    }

    @Test fun `the verify prompt names photos by position only`() {
        val text = PromptBuilder.verifySystem() + PromptBuilder.photoLabel(1, 3)
        assertTrue(text.contains("Photo 1 of 3") && text.contains("groups"), text)
        assertTrue(!Regex("[0-9a-f]{8}-[0-9a-f]{4}-").containsMatchIn(text) && !text.contains(".jpg"), text)
    }
}
