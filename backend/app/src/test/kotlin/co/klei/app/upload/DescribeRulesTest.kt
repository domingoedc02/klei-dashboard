package co.klei.app.upload

import co.klei.app.ai.PromptBuilder
import co.klei.core.ai.AiProviderException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class DescribeRulesTest {
    private val allowed = mapOf("silhouette" to listOf("A-line", "Mermaid"), "fabric" to listOf("Lace", "Tulle"))

    @Test fun `mapper keeps only allowed values, case-insensitive, with the studio's spelling`() {
        val tags = TaxonomyMapper.map(mapOf("silhouette" to listOf(" a-LINE ", "Trumpet"), "fabric" to listOf("lace", "lace"), "color" to listOf("Ivory")), allowed)
        assertEquals(listOf("silhouette:A-line", "fabric:Lace"), tags.map { "${it.type}:${it.value}" })
    }

    @Test fun `an answer with only unknown values maps to nothing and scores Low`() {
        val answer = mapOf("silhouette" to listOf("Trumpet"), "fabric" to listOf("Satin"))
        val tags = TaxonomyMapper.map(answer, allowed)
        assertTrue(tags.isEmpty())
        assertTrue(confidenceBand(ConfidenceScorer.score(95, tags.size, TaxonomyMapper.named(answer))) != "high")
        assertEquals("low", confidenceBand(ConfidenceScorer.score(40, 0, 2)))
    }

    @Test fun `a fully accepted answer keeps a tight group High`() {
        assertEquals("high", confidenceBand(ConfidenceScorer.score(96, 3, 3)))
        assertEquals(0, ConfidenceScorer.score(0, 0, 0))
    }

    @Test fun `the taxonomy share can only lower the score`() {
        for (s in 0..100) {
            assertEquals(s, ConfidenceScorer.score(s, 3, 3), "share 1 equals similarity at $s")
            assertEquals(s * 7 / 10, ConfidenceScorer.score(s, 0, 3), "share 0 gives 0.7 of similarity at $s")
            assertEquals(s * 7 / 10, ConfidenceScorer.score(s, 2, 0), "naming nothing is share 0 at $s")
            assertTrue(ConfidenceScorer.score(s, 1, 3) in (s * 7 / 10)..s, "partial share stays between at $s")
        }
        assertEquals(100, ConfidenceScorer.score(150, 9, 3), "inputs are clamped")
    }

    @Test fun `names are trimmed to 80 characters and fall back when empty`() {
        assertEquals(80, TaxonomyMapper.name("x".repeat(200), "Group 1").length)
        assertEquals("Group 1", TaxonomyMapper.name("   ", "Group 1"))
    }

    @Test fun `prompt carries the tone and the allowed values and nothing that identifies a photo`() {
        val text = PromptBuilder.system("editorial", allowed) + PromptBuilder.photoLabel(2, 4)
        assertTrue(text.contains("editorial") && text.contains("A-line, Mermaid") && text.contains("Photo 2 of 4"), text)
        assertFalse(Regex("[0-9a-f]{8}-[0-9a-f]{4}-").containsMatchIn(text) || text.contains(".jpg"), text)
    }

    @Test fun `answer is read through code fences and a wrong shape is a bad response`() {
        val ok = PromptBuilder.parseAnswer("Here you go:\n```json\n{\"name\":\"Rose\",\"attributes\":{\"Silhouette\":[\"A-line\"],\"fabric\":\"Lace\"},\"description\":\"Soft.\"}\n```")
        assertEquals("Rose", ok.name)
        assertEquals(mapOf("silhouette" to listOf("A-line"), "fabric" to listOf("Lace")), ok.attributes)
        assertFailsWith<AiProviderException> { PromptBuilder.parseAnswer("no json here") }
        assertFailsWith<AiProviderException> { PromptBuilder.parseCompletion("""{"choices":[]}""") }
    }
}
