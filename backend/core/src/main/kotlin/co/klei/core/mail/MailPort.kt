package co.klei.core.mail

/** Each template names the only variables it may carry (architecture §8.2); the adapter refuses any other model. */
enum class MailTemplate(val file: String, val subject: String, val allowed: Set<String>) {
    INVITE("invite", "You're invited to Klei Bridal", setOf("link")),
    VERIFY("verify", "Your Klei Bridal verification code", setOf("code", "link")),
    RESET("reset", "Reset your Klei Bridal password", setOf("link")),
    REPLY("reply", "A message from Klei Bridal", setOf("body", "signature")),
    /** FR-32: the Admin's away message to a client who just wrote in. `first` is the greeting; nothing else about the client or inquiry. */
    AWAY("away", "A message from Klei Bridal", setOf("body", "first")),
    /** FR-34, real-time: one bell title. */
    NOTIFY("notify", "New activity in Klei Bridal", setOf("title")),
    /** FR-34, digest: [items] is one "- title" line per notification, [more] is "" or "and 3 more". Titles only. */
    DIGEST("digest", "Your Klei Bridal digest", setOf("items", "more")),
}

/** One file on a reply mail. [name] is a display name, never a path. */
class MailAttachment(val name: String, val bytes: ByteArray)

class ReplyMail(val to: String, val subject: String, val html: String, val text: String, val attachments: List<MailAttachment>)

interface MailPort {
    /** Queues the mail and returns; a send failure is logged, never thrown, so timing never tells a known address from an unknown one. */
    fun send(template: MailTemplate, to: String, model: Map<String, String>)

    /** FR-21: sends now, on the caller's thread, and answers whether the mail server took it. A failure is logged by class name only. */
    fun sendReply(mail: ReplyMail): Boolean
}
