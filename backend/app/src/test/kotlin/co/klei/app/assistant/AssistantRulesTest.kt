package co.klei.app.assistant

import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Story 8.3: the pure rules: routing, what may leave for the provider, and which Gown tokens survive. */
class AssistantRulesTest {
    @Test fun `routing picks intents from keywords`() {
        assertEquals(setOf(Intent.SUMMARIZE), Routing.of("Summarize new inquiries"))
        assertEquals(setOf(Intent.DRAFT), Routing.of("Draft a reply"))
        assertEquals(setOf(Intent.GOWNS), Routing.of("Suggest gowns"))
        assertEquals(emptySet(), Routing.of("hello"))
        assertTrue(Routing.mentionsInquiries("what did the client ask"))
    }

    @Test fun `an item drops email addresses and folds white space`() {
        val c = ContextRules.clean("Write to  priya.nair+vip@mail.example.co.uk\nor ada@example.test now")
        assertEquals("Write to [email removed] or [email removed] now", c)
        assertFalse(c.contains("@"))
    }

    @Test fun `an item never passes 2 KB and never splits a character`() {
        val s = "é".repeat(3000) + "😀".repeat(10)
        val c = ContextRules.clean(s)
        assertTrue(c.toByteArray().size <= ContextRules.MAX_ITEM_BYTES)
        assertTrue(c.all { it != '�' })
        assertEquals("é".repeat(1024), c)
        val emoji = ContextRules.cut("a" + "😀".repeat(600))
        assertTrue(emoji.toByteArray().size <= ContextRules.MAX_ITEM_BYTES)
        assertEquals(0, emoji.count { Character.isSurrogate(it) } % 2)
    }

    @Test fun `the guard keeps offered Gowns once, as names, and removes every other token`() {
        val a = UUID.randomUUID()
        val stranger = UUID.randomUUID()
        val g = GownNameGuard.apply("Try [gown:$a] or [gown:$stranger]; [gown:$a] again, [gown:not-an-id].", mapOf(a to "Magnolia"))
        assertEquals("Try Magnolia or ; Magnolia again, [gown:not-an-id].", g.text)
        assertEquals(listOf(a), g.ids)
        assertEquals(setOf(a, stranger), GownNameGuard.referenced("[gown:$a][gown:$stranger]"))
    }

    @Test fun `a Gown name written without a token links to nothing`() {
        val a = UUID.randomUUID()
        val g = GownNameGuard.apply("I like Magnolia.", mapOf(a to "Magnolia"))
        assertEquals("I like Magnolia.", g.text)
        assertEquals(emptyList(), g.ids)
    }
}
