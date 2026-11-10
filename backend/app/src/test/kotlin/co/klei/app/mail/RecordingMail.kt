package co.klei.app.mail

import co.klei.core.mail.MailPort
import co.klei.core.mail.MailTemplate
import co.klei.core.mail.ReplyMail
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary
import org.springframework.transaction.support.TransactionSynchronization
import org.springframework.transaction.support.TransactionSynchronizationManager
import java.util.concurrent.CopyOnWriteArrayList

/** Test double: keeps what would have been mailed. [failReplies] makes the next replies report a failed send. */
class RecordingMail : MailPort {
    data class Sent(val template: MailTemplate, val to: String, val model: Map<String, String>)

    val sent = CopyOnWriteArrayList<Sent>()
    val replies = CopyOnWriteArrayList<ReplyMail>()
    @Volatile var failReplies = false
    /** Makes [send] throw, like a mail adapter that refuses a recipient. */
    @Volatile var failSends = false

    override fun send(template: MailTemplate, to: String, model: Map<String, String>) {
        require(model.keys == template.allowed)
        check(!failSends) { "mail refused" }
        val mail = Sent(template, to, model)
        // Like the real adapter: nothing leaves before the caller's transaction commits, and a rollback sends nothing.
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(object : TransactionSynchronization { override fun afterCommit() { sent += mail } })
        } else sent += mail
    }

    override fun sendReply(mail: ReplyMail): Boolean {
        if (failReplies) return false
        replies += mail
        return true
    }

    fun last(template: MailTemplate, to: String): Sent = sent.last { it.template == template && it.to == to }
}

@TestConfiguration
class RecordingMailConfig {
    @Bean @Primary fun recordingMail() = RecordingMail()
}
