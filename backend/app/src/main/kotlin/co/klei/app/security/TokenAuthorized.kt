package co.klei.app.security

/**
 * Marks an endpoint any signed-in User may call, whatever their Permissions (for example `/me`).
 * Enforced by the filter chain (everything outside the public paths needs a valid token); this marker only
 * satisfies the architecture rule that every endpoint states its authorization.
 */
@Target(AnnotationTarget.FUNCTION, AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class TokenAuthorized
