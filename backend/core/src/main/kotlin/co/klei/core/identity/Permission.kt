package co.klei.core.identity

/** Authority names are the constant names (architecture §6.3). Checks use these, never a role name. */
enum class Permission(val editable: Boolean = true) {
    PERM_VIEW_GALLERY,
    PERM_UPLOAD_IMAGES,
    PERM_EDIT_GOWN,
    PERM_DELETE_GOWN,
    PERM_REPLY,
    PERM_CLOSE_INQUIRY,
    PERM_MANAGE_STAFF,
    PERM_AI_SETTINGS,
    PERM_VIEW_AUDIT,
    PERM_KEY_ROTATE(editable = false),
    /** The away message and closure schedule (FR-32). Admin only, so it stays out of the Roles matrix. */
    PERM_AWAY(editable = false),
}

enum class UserStatus { ACTIVE, INVITED }

/** Default matrix seeded once by migration (architecture §6.3). */
object DefaultRoles {
    const val ADMIN = "Admin"
    const val STAFF = "Staff"
    const val VIEWER = "Viewer"

    val matrix: Map<String, Set<Permission>> = mapOf(
        ADMIN to Permission.entries.toSet(),
        STAFF to setOf(
            Permission.PERM_VIEW_GALLERY, Permission.PERM_UPLOAD_IMAGES, Permission.PERM_EDIT_GOWN,
            Permission.PERM_REPLY, Permission.PERM_CLOSE_INQUIRY,
        ),
        VIEWER to setOf(Permission.PERM_VIEW_GALLERY),
    )
}

/** FR-5: at least 8 characters and a digit; at most 128 (Argon2id input bound). */
object PasswordPolicy {
    fun accepts(password: String): Boolean = password.length in 8..128 && password.any { it.isDigit() }
}
