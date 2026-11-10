package co.klei.app.ai

import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.Environment

@Configuration
class AiConfiguration {
    /** `KLEI_AI_DEV_MODE` opens plain HTTP and private addresses for a stub provider; any profile but dev or test refuses to start. */
    @Bean
    fun ssrfGuard(env: Environment, @Value("\${klei.ai.dev-mode:false}") dev: Boolean): SsrfGuard {
        check(!dev || env.activeProfiles.any { it == "dev" || it == "test" }) { "KLEI_AI_DEV_MODE is only allowed under the dev or test profile" }
        return SsrfGuard(dev)
    }
}
