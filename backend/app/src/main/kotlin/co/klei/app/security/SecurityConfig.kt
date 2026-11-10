package co.klei.app.security

import co.klei.app.web.PortGuardFilter
import co.klei.app.web.Problems
import co.klei.crypto.TokenSigner
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.userdetails.UserDetailsService
import org.springframework.security.core.userdetails.UsernameNotFoundException
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter
import org.springframework.security.web.header.writers.ReferrerPolicyHeaderWriter
import org.springframework.security.web.header.writers.StaticHeadersWriter

/** Stateless bearer-token chain (architecture §6.1). Roles never appear here: only Permissions (AD-9). */
@Configuration
@EnableMethodSecurity(jsr250Enabled = true)
class SecurityConfig {
    @Bean
    fun chain(
        http: HttpSecurity, tokens: TokenSigner, sessions: SessionRegistry, epoch: PermissionEpoch, problems: SecurityProblems,
    ): SecurityFilterChain = http
        .csrf { it.disable() }
        .formLogin { it.disable() }
        .httpBasic { it.disable() }
        .logout { it.disable() }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
        .authorizeHttpRequests { a ->
            a.requestMatchers("/health", "/health/**").permitAll()
            PortGuardFilter.AUTH_PREFIXES.forEach { a.requestMatchers(it, "$it/**").permitAll() }
            // The code and the refresh token are the credentials here; each method also carries @PermitAll.
            a.requestMatchers("/api/v1/auth/token", "/api/v1/auth/refresh", "/api/v1/auth/logout").permitAll()
            a.anyRequest().authenticated()
        }
        .exceptionHandling { e ->
            e.authenticationEntryPoint { req, res, _ ->
                res.setHeader("WWW-Authenticate", "Bearer")
                Problems.write(problems.unauthenticated(req), req, res)
            }
            e.accessDeniedHandler { req, res, _ -> Problems.write(problems.denied(req), req, res) }
        }
        // Not a bean, so Boot does not also register it as a plain servlet filter.
        .addFilterBefore(JwtAuthFilter(tokens, sessions, epoch), UsernamePasswordAuthenticationFilter::class.java)
        .build()

    /**
     * Auth Web (architecture §6.2): the only chain with a cookie session and CSRF. It matches the Auth Web paths only;
     * the port guard already keeps them off the API port and the API off this one.
     */
    @Bean
    @Order(1)
    fun authWebChain(http: HttpSecurity): SecurityFilterChain = http
        .securityMatcher(*PortGuardFilter.AUTH_PREFIXES.flatMap { listOf(it, "$it/**") }.toTypedArray())
        .csrf { }
        .formLogin { it.disable() }
        .httpBasic { it.disable() }
        .logout { it.disable() }
        .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED) }
        .authorizeHttpRequests { it.anyRequest().permitAll() }
        .headers { h ->
            h.contentSecurityPolicy { it.policyDirectives("default-src 'self'; frame-ancestors 'none'") }
            h.referrerPolicy { it.policy(ReferrerPolicyHeaderWriter.ReferrerPolicy.NO_REFERRER) }
            h.cacheControl { it.disable() }
            h.addHeaderWriter(StaticHeadersWriter("Cache-Control", "no-store"))
        }
        .exceptionHandling { e ->
            e.accessDeniedHandler { req, res, _ -> req.getRequestDispatcher("/login/denied").forward(req, res) }
        }
        .build()

    /** There are no local accounts in the framework's sense; this stops Boot generating a throwaway password. */
    @Bean
    fun userDetailsService() = UserDetailsService { throw UsernameNotFoundException("none") }
}
