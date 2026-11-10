package co.klei.app.mail

import co.klei.core.mail.MailTemplate
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.springframework.mail.javamail.JavaMailSender
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Leak check per template (story 2.1): only the allowed variables reach the text, and nothing else is in it. */
class MailTemplateTest {
    private val adapter = SmtpMailAdapter(mock(JavaMailSender::class.java), "no-reply@klei.test")
    private val sample = mapOf("link" to "LINK-VALUE", "code" to "CODE-VALUE", "body" to "BODY-VALUE", "signature" to "SIG-VALUE", "first" to "FIRST-VALUE", "title" to "TITLE-VALUE", "items" to "ITEMS-VALUE", "more" to "MORE-VALUE")

    @Test fun `each template renders exactly its allowed variables`() {
        MailTemplate.entries.forEach { t ->
            val text = adapter.render(t, sample.filterKeys { it in t.allowed }).body
            sample.forEach { (k, v) -> assertEquals(k in t.allowed, text.contains(v), "${t.file}: $k") }
        }
    }

    @Test fun `an extra or missing variable is refused`() {
        assertFailsWith<IllegalArgumentException> { adapter.render(MailTemplate.INVITE, mapOf("link" to "x", "name" to "Ada")) }
        assertFailsWith<IllegalArgumentException> { adapter.render(MailTemplate.VERIFY, mapOf("code" to "123456")) }
    }

    @Test fun `the away mail carries only the message and the first name, and nothing else is accepted`() {
        assertEquals(setOf("body", "first"), MailTemplate.AWAY.allowed)
        val text = adapter.render(MailTemplate.AWAY, mapOf("body" to "We are away.", "first" to "Mara")).body
        assertEquals("Hi Mara,\n\nWe are away.", text.trim())
        listOf(mapOf("body" to "b", "first" to "f", "email" to "a@b.test"), mapOf("body" to "b", "first" to "f", "signature" to "s"), mapOf("body" to "b"))
            .forEach { assertFailsWith<IllegalArgumentException> { adapter.render(MailTemplate.AWAY, it) } }
    }

    @Test fun `notify and digest mail carry titles only and end with the settings line`() {
        val note = adapter.render(MailTemplate.NOTIFY, mapOf("title" to "New inquiry from Wren")).body
        val digest = adapter.render(MailTemplate.DIGEST, mapOf("items" to "- One\n- Two", "more" to "and 3 more")).body
        listOf(note, digest).forEach { assertTrue(it.trim().endsWith("Change what you get by email in Settings › Notifications."), it) }
        assertTrue(note.contains("New inquiry from Wren") && digest.contains("- Two\nand 3 more"), digest)
        listOf(note, digest).forEach { assertFalse(it.contains("unsubscribe", ignoreCase = true) || it.contains("http"), it) }
    }

    @Test fun `invite and verify mail say nothing about who invited or which role`() {
        val invite = adapter.render(MailTemplate.INVITE, mapOf("link" to "L")).body.lowercase()
        val verify = adapter.render(MailTemplate.VERIFY, mapOf("code" to "1", "link" to "L")).body.lowercase()
        listOf("admin", "staff", "viewer", "invited by", "role").forEach { assertFalse(it in invite || it in verify, it) }
    }

    @Test fun `headers lose line breaks and path separators and the recipient is checked`() {
        assertEquals("a b c d", SmtpMailAdapter.header("a\r\nb/c\\d"))
        assertTrue(SmtpMailAdapter.ADDRESS.matches("ada@example.test"))
        listOf("a@b.test\r\nBcc: x@y.test", "a@b.test,c@d.test", "<a@b.test>", "no-at-sign").forEach { assertFalse(SmtpMailAdapter.ADDRESS.matches(it), it) }
    }
}
