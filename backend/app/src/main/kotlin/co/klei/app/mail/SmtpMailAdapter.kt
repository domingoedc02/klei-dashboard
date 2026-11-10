package co.klei.app.mail

import co.klei.core.mail.MailPort
import co.klei.core.mail.ReplyMail
import co.klei.core.mail.MailTemplate
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.io.ByteArrayResource
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.mail.javamail.MimeMessageHelper
import org.springframework.stereotype.Component
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import org.thymeleaf.spring6.SpringTemplateEngine
import org.thymeleaf.context.Context
import org.thymeleaf.templatemode.TemplateMode
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver
import java.util.concurrent.Executors

/**
 * SMTP adapter (architecture §8.2). Sending runs on a small pool after the caller's transaction commits, so a rolled-back
 * action sends nothing and the response time does not depend on the mail server.
 * shortcut: no retry and no outbox; a failed auth mail is logged by template name and the User asks again (resend or sign-in).
 */
@Component
class SmtpMailAdapter(private val sender: JavaMailSender, @Value("\${klei.mail.from}") from: String) : MailPort {
    private val log = LoggerFactory.getLogger(SmtpMailAdapter::class.java)
    // The blank fallback is for dev and test; StartupChecks refuses a blank KLEI_MAIL_FROM everywhere else.
    private val from = header(from).ifBlank { "no-reply@klei.test" }
    private val pool = Executors.newFixedThreadPool(2) { r -> Thread(r, "mail").apply { isDaemon = true } }
    private val engine = SpringTemplateEngine().apply {
        setTemplateResolver(
            ClassLoaderTemplateResolver().apply { prefix = "mail/"; suffix = ".txt"; templateMode = TemplateMode.TEXT; characterEncoding = "UTF-8"; isCacheable = true },
        )
    }

    class Rendered(val subject: String, val body: String)

    internal fun render(t: MailTemplate, model: Map<String, String>): Rendered {
        require(model.keys == t.allowed) { "template ${t.file} takes ${t.allowed}" }
        val ctx = Context().also { c -> model.forEach { (k, v) -> c.setVariable(k, v) } }
        return Rendered(header(t.subject), engine.process(t.file, ctx))
    }

    override fun send(template: MailTemplate, to: String, model: Map<String, String>) {
        require(ADDRESS.matches(to)) { "bad recipient" }
        val r = render(template, model)
        val job = Runnable {
            try {
                val m = sender.createMimeMessage()
                MimeMessageHelper(m, false, "UTF-8").apply { setFrom(from); setTo(to); setSubject(r.subject); setText(r.body, false) }
                sender.send(m)
            } catch (e: Exception) {
                // Class name only: the message may hold the address.
                log.warn("mail {} not sent: {}", template.file, e.javaClass.simpleName)
            }
        }
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization {
                override fun afterCommit() = pool.execute(job)
            })
        } else {
            pool.execute(job)
        }
    }

    override fun sendReply(mail: ReplyMail): Boolean = try {
        val m = sender.createMimeMessage()
        MimeMessageHelper(m, true, "UTF-8").apply {
            setFrom(from); setReplyTo(from); setTo(mail.to); setSubject(header(mail.subject)); setText(mail.text, mail.html)
            mail.attachments.forEach { addAttachment(header(it.name).ifBlank { "attachment" }, ByteArrayResource(it.bytes), "application/octet-stream") }
        }
        sender.send(m)
        true
    } catch (e: Exception) {
        // Class name only: the message may hold the address.
        log.warn("reply mail not sent: {}", e.javaClass.simpleName)
        false
    }

    companion object {
        val ADDRESS = Regex("[^@\\s<>,;\"]{1,64}@[^@\\s<>,;\"]{1,255}")

        /** CR/LF and path separators out of anything that lands in a header or file name. */
        fun header(s: String): String = s.replace(Regex("[\\r\\n/\\\\]+"), " ").trim()
    }
}
