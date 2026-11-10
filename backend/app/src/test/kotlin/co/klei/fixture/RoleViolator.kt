package co.klei.fixture

import org.springframework.security.access.prepost.PreAuthorize

/** Deliberate violation: authorization by Role name. Only the negative architecture test reads this package. */
class RoleViolator {
    @PreAuthorize("hasRole('Admin')")
    fun byRole(): Int = 1
}
