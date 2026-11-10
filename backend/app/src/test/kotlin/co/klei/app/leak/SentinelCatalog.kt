package co.klei.app.leak

import co.klei.app.TestSupport
import java.util.UUID

/**
 * One entry per `_ct` column (NFR-1). The value lists the Sentinel strings the suite writes into that column through app code.
 * An empty list means the column holds a fixed word or a timestamp that a text search cannot tell from noise.
 * A story that adds a `_ct` column adds its line here; `LeakSuiteIT` fails the build when a column has no entry or an entry has no column.
 */
object SentinelCatalog {
    private fun s(label: String) = "zq$label" + UUID.randomUUID().toString().replace("-", "")

    val name1 = s("name1"); val name2 = s("name2")
    val email1 = s("email1") + "@sentinel.test"; val email2 = s("email2") + "@sentinel.test"
    val password1 = s("pw9a"); val password2 = s("pw9b")
    // The invited User: the admin types name3, the invitee replaces it with name4 on page A2 and picks password3.
    val name3 = s("name3"); val name4 = s("name4"); val email3 = s("email3") + "@sentinel.test"; val password3 = s("pw9c")
    // The same User forgets the password (A4) and picks password4 on page A5.
    val password4 = s("pw9d")
    // Staff screen (Story 2.3): an Admin invites name5 at email4, edits it to name6 at email5, resends the invite, then deletes the User.
    val name5 = s("name5"); val name6 = s("name6"); val email4 = s("email4") + "@sentinel.test"; val email5 = s("email5") + "@sentinel.test"
    // Roles screen (Story 2.4): Permission names are fixed words, so they are the Sentinels; the suite toggles one on Staff and back.
    val permissions = co.klei.core.identity.Permission.entries.map { it.name }
    // AI settings (Story 3.1): the Admin saves a provider address, key, organization and model names; the stub answers with model ids.
    val aiUrlPath = s("aipath"); val aiKey = s("aikey"); val aiOrg = s("aiorg"); val aiChat = s("aichat"); val aiVision = s("aivision"); val aiEmbed = s("aiembed"); val aiVisionAdv = s("aivisionadv")
    // Separate embeddings provider: another host on the same stub, so it must bring its own key.
    val aiEmbedPath = s("aiembedpath"); val aiEmbedKey = s("aiembedkey")
    val taxAdded = s("taxadded"); val taxRenamed = s("taxrenamed")
    // AI usage (Story 3.3): a recorded call carries a prompt and a response that no endpoint may return.
    val usagePrompt = s("usageprompt"); val usageResponse = s("usageresponse")
    val aiModelA = s("aimodela"); val aiModelB = s("aimodelb")
    val aiProviderText = s("aiprovider")
    // Upload (Story 4.1): the file name and a JPEG comment segment must never leave the encrypted columns or objects.
    val uploadName = s("upname") + ".jpg"; val exifComment = s("exifcomment")
    // Grouping (Story 4.3): the stub answers every image with these floats; their decimal text must exist only inside the vector envelope.
    val vectorFloats = floatArrayOf(0.31415927f, 0.27182817f, 0.57721567f); val vectorText = vectorFloats.map { it.toString() }
    // Tagging (Story 4.4): the stub names and describes a gown with these; both live only in the group's encrypted columns.
    val gownName = s("gownname"); val gownDescription = s("gowndesc")
    // Review (Story 4.5): a Staff member retypes the name and the description.
    val editedName = s("editname"); val editedDescription = s("editdesc")
    // Commit and Rewrite (Story 11.6): the staged name and description travel in one POST body; Rewrite's answer comes back and is staged.
    val commitName = s("commitname"); val commitDescription = s("commitdesc"); val rewriteText = s("rewritetext")
    // Gown edit (Story 5.3): a saved Gown retyped through PATCH /api/v1/gowns/{id}; both words also feed the gown_term blind index.
    val gownEditName = s("gownedit"); val gownEditDescription = s("gowneditdesc")
    // Profile (Story 6.1): a User renames themself, uploads a photo with a JPEG comment, then changes the password to password5.
    val profileName = s("profname"); val avatarExif = s("avatarexif"); val password5 = s("pw9e")
    val sigSignoff = s("sigsignoff"); val sigName = s("signame"); val sigTitle = s("sigtitle"); val sigPhone = s("sigphone")
    val studioName = s("studioname"); val studioAddress = s("studioaddr")
    // Preferences (Story 6.3): the zone is a fixed word, so it is the Sentinel; the suite saves it through PUT /api/v1/me/preferences.
    val prefsZone = "Pacific/Kiritimati"
    // Assistant (Story 8.3): the staff question and the provider answer are chat lines, sealed at rest; the question also goes to the provider by design.
    val chatQuestion = s("chatq"); val chatAnswer = s("chata")
    // Inquiries (Story 7.1): a Client writes in; name, address, subject and message text live only in the inquiry envelopes.
    val clientName = s("clientname"); val clientEmail = s("clientemail") + "@sentinel.test"; val inquirySubject = s("inqsubject"); val inquiryBody = s("inqbody")
    // Reply (Story 7.3): the reply text, a draft, an attachment name and its bytes; none may leave the envelopes (a mail to the Client carries the text and the file by design).
    val replyText = s("replytext"); val draftText = s("drafttext"); val attachName = s("attname") + ".txt"; val attachBody = s("attbody")
    // Client edit (Story 7.4): phone is capped at 40 characters, so it is shorter; date and source are fixed forms and act as words.
    val clientPhone = "zqph" + UUID.randomUUID().toString().replace("-", "").take(20); val clientCity = s("city"); val clientNote = s("clientnote")
    val weddingDate = "2031-07-19"; val clientSource = "Instagram"
    // Away message (Story 11.12): the Admin's text and a client who writes in during the closure. The mail carries the text and the first name by design.
    val awayMessage = s("awaymsg"); val awayClientName = s("awayclient"); val awayClientEmail = s("awayclientemail") + "@sentinel.test"
    // Key custody (Story 9.2): the base64 text of every key in the environment must be in no table, object, mail, log or status answer.
    val keyText = listOf(1, 2, 50, 100).map { TestSupport.key(it) }
    val actor = s("actor"); val detail = s("detail"); val ip = s("ip"); val objectBody = s("object")
    private const val PHC_PREFIX = "\$argon2id\$v=19"

    val columns: Map<String, List<String>> = mapOf(
        "app_user.name_ct" to listOf(name1, name2, name3, name4, name5, name6, profileName),
        "app_user.email_ct" to listOf(email1, email2, email3, email4, email5, TestSupport.ADMIN_EMAIL),
        "app_user.password_ct" to listOf(password1, password2, password3, password4, password5, TestSupport.ADMIN_PASSWORD, PHC_PREFIX),
        "app_user.status_ct" to emptyList(),
        "app_user.verified_ct" to emptyList(),
        "app_user.created_at_ct" to emptyList(),
        "app_user.last_active_ct" to emptyList(),
        "app_user.prefs_ct" to listOf(prefsZone),
        // The refresh token is random per sign-in; the suite captures a real one and adds it as a Sentinel (see LeakSuiteIT).
        "refresh_token.token_ct" to emptyList(),
        "refresh_token.expires_at_ct" to emptyList(),
        "refresh_token.spent_at_ct" to emptyList(),
        // Random per credential; the suite reads the invite and verify mails from Mailpit and adds the token and code (see LeakSuiteIT).
        "auth_credential.kind_ct" to emptyList(),
        "auth_credential.secret_ct" to emptyList(),
        "auth_credential.code_ct" to emptyList(),
        "auth_credential.expires_at_ct" to emptyList(),
        "auth_credential.attempts_ct" to emptyList(),
        "audit_entry.ts_ct" to emptyList(),
        "audit_entry.actor_id_ct" to emptyList(),
        "audit_entry.actor_name_ct" to listOf(actor),
        "audit_entry.action_ct" to emptyList(),
        "audit_entry.detail_ct" to listOf(detail) + permissions,
        "audit_entry.ip_ct" to listOf(ip),
        "ai_setting.preset_ct" to emptyList(),
        "ai_setting.base_url_ct" to listOf(aiUrlPath),
        "ai_setting.api_key_ct" to listOf(aiKey),
        "ai_setting.embedding_base_url_ct" to listOf(aiEmbedPath),
        "ai_setting.embedding_api_key_ct" to listOf(aiEmbedKey),
        "ai_setting.organization_ct" to listOf(aiOrg),
        "ai_setting.chat_model_ct" to listOf(aiChat),
        "ai_setting.vision_model_ct" to listOf(aiVision),
        "ai_setting.vision_model_adv_ct" to listOf(aiVisionAdv),
        "ai_setting.sensitivity_ct" to emptyList(),
        "ai_setting.tone_ct" to emptyList(),
        "ai_setting.advanced_ct" to emptyList(),
        "ai_setting.embedding_model_ct" to listOf(aiEmbed),
        "ai_setting.temperature_ct" to emptyList(),
        "ai_setting.max_tokens_ct" to emptyList(),
        "ai_setting.status_ct" to emptyList(),
        "ai_setting.tested_at_ct" to emptyList(),
        "ai_setting.models_ct" to listOf(aiModelA, aiModelB),
        "ai_usage.purpose_ct" to emptyList(),
        "ai_usage.model_ct" to listOf(aiEmbed),
        "ai_usage.size_ct" to emptyList(),
        "ai_usage.outcome_ct" to emptyList(),
        "ai_usage.duration_ct" to emptyList(),
        "ai_usage.prompt_ct" to listOf(usagePrompt),
        "ai_usage.response_ct" to listOf(usageResponse),
        "ai_usage.created_at_ct" to emptyList(),
        "taxonomy_value.type_ct" to emptyList(),
        "taxonomy_value.value_ct" to listOf(taxAdded, taxRenamed),
        "signature.enabled_ct" to emptyList(),
        "signature.signoff_ct" to listOf(sigSignoff),
        "signature.name_ct" to listOf(sigName),
        "signature.title_ct" to listOf(sigTitle),
        "signature.phone_ct" to listOf(sigPhone),
        "workspace.studio_name_ct" to listOf(studioName),
        "workspace.studio_address_ct" to listOf(studioAddress),
        "stored_object.created_at_ct" to emptyList(),
        "upload_batch.phase_ct" to emptyList(),
        "upload_batch.progress_ct" to emptyList(),
        "upload_batch.error_ct" to emptyList(),
        "upload_batch.rejected_ct" to emptyList(),
        "upload_batch.created_at_ct" to emptyList(),
        "photo.filename_ct" to listOf(uploadName),
        "photo.content_type_ct" to emptyList(),
        "photo.size_ct" to emptyList(),
        "photo.created_at_ct" to emptyList(),
        "photo.state_ct" to emptyList(),
        "embedding.vector_ct" to vectorText,
        "embedding.model_ct" to emptyList(),
        "embedding.dim_ct" to emptyList(),
        "upload_group.name_ct" to listOf(gownName, editedName, commitName),
        "upload_group.attributes_ct" to emptyList(),
        "upload_group.description_ct" to listOf(gownDescription, editedDescription, commitDescription),
        "upload_group.confidence_ct" to emptyList(),
        "upload_group.position_ct" to emptyList(),
        "gown.name_ct" to listOf(gownName, editedName, gownEditName, commitName),
        "gown.description_ct" to listOf(gownDescription, editedDescription, gownEditDescription, commitDescription, rewriteText),
        "gown.confidence_ct" to emptyList(),
        "gown.is_new_ct" to emptyList(),
        "gown.created_at_ct" to emptyList(),
        "client.name_ct" to listOf(clientName, awayClientName),
        "client.email_ct" to listOf(clientEmail, awayClientEmail),
        "client.created_at_ct" to emptyList(),
        "client.phone_ct" to listOf(clientPhone),
        "client.city_ct" to listOf(clientCity),
        "client.wedding_date_ct" to listOf(weddingDate),
        "client.source_ct" to listOf(clientSource),
        "client.note_ct" to listOf(clientNote),
        "inquiry.subject_ct" to listOf(inquirySubject),
        "inquiry.preview_ct" to listOf(inquiryBody),
        "inquiry.status_ct" to emptyList(),
        "inquiry.unread_ct" to emptyList(),
        "inquiry.last_message_at_ct" to emptyList(),
        "message.direction_ct" to emptyList(),
        "message.body_ct" to listOf(inquiryBody, replyText),
        "message.created_at_ct" to emptyList(),
        "message.mail_state_ct" to emptyList(),
        "message.mail_at_ct" to emptyList(),
        "attachment.name_ct" to listOf(attachName),
        "attachment.size_ct" to emptyList(),
        "attachment.created_at_ct" to emptyList(),
        "draft.body_ct" to listOf(draftText),
        "draft.updated_at_ct" to emptyList(),
        // Story 8.1: the new-inquiry line names the Client; the accepted-invite line names the new User.
        "notification.type_ct" to emptyList(),
        "notification.title_ct" to listOf(clientName, name4),
        "notification.target_ct" to emptyList(),
        "notification.read_ct" to emptyList(),
        "notification.created_at_ct" to emptyList(),
        "chat_message.role_ct" to emptyList(),
        "chat_message.text_ct" to listOf(chatQuestion, chatAnswer),
        "chat_message.gowns_ct" to emptyList(),
        "chat_message.created_at_ct" to emptyList(),
        // Story 11.12: the message is the Sentinel; flag, schedule and window start are fixed words, flags or times.
        "away.enabled_ct" to emptyList(),
        "away.message_ct" to listOf(awayMessage),
        "away.schedule_ct" to emptyList(),
        "away_sent.window_start_ct" to emptyList(),
        "notification_digest.last_digest_at_ct" to emptyList(),
        // Story 11.14: the secret, the otpauth URI and the recovery codes are random per run, so `LeakSuiteIT.twoFactorEdits` adds them to `captured`.
        "user_totp.secret_ct" to emptyList(),
        "user_totp.state_ct" to emptyList(),
        "user_totp.last_used_step_ct" to emptyList(),
        "recovery_code.hash_ct" to listOf(PHC_PREFIX),
        "recovery_code.used_at_ct" to emptyList(),
        "role.name_ct" to emptyList(),
        "role_permission.permission_ct" to permissions,
    )

    /** Written outside the database: the S3 object body (the planted object; the upload path adds its own in `LeakSuiteIT`). */
    val sealedBody = listOf(objectBody)

    /** Random values only known at run time (one-time code, access and refresh token); `LeakSuiteIT.seed` adds them after a real sign-in. */
    val captured = java.util.concurrent.CopyOnWriteArrayList<String>()

    /** Secrets that a mail legitimately carries (invite and verify links, the code); everywhere except Mailpit they are still Sentinels. */
    val mailed = java.util.concurrent.CopyOnWriteArrayList<String>()

    /** The recipient address is the one personal value a mail may hold. */
    val mailRecipients: Set<String> get() = setOf(email3, email4, email5)

    val all: List<String> get() = (columns.values.flatten() + exifComment + avatarExif + attachBody + sealedBody + captured + mailed + aiProviderText + keyText).distinct()
}
