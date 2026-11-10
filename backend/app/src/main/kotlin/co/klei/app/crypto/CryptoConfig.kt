package co.klei.app.crypto

import co.klei.app.boot.StartupChecks
import co.klei.crypto.BlindIndex
import co.klei.crypto.CryptoModule
import co.klei.crypto.CryptoService
import co.klei.crypto.KeyRotation
import co.klei.crypto.MigrationCrypto
import co.klei.crypto.ObjectCipher
import co.klei.crypto.PasswordHasher
import co.klei.crypto.SecureTokens
import co.klei.crypto.TokenSigner
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.boot.hibernate.autoconfigure.HibernatePropertiesCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.stereotype.Component
import org.springframework.core.annotation.Order
import org.springframework.core.env.ConfigurableEnvironment
import org.springframework.core.env.EnumerablePropertySource
import javax.sql.DataSource

/** The single wiring point of the crypto module (AD-2). Keys come from `KLEI_*` environment entries only. */
@Configuration
class CryptoConfig {
    @Bean
    fun cryptoModule(env: ConfigurableEnvironment, db: DataSource): CryptoModule {
        val klei = env.propertySources.filterIsInstance<EnumerablePropertySource<*>>()
            .flatMap { it.propertyNames.asList() }.filter { it.startsWith("KLEI_") }.distinct()
            .mapNotNull { n -> env.getProperty(n)?.let { n to it } }.toMap()
        return CryptoModule(klei, db, StartupChecks.otherSecrets(klei))
    }

    @Bean fun cryptoService(m: CryptoModule): CryptoService = m.crypto
    @Bean fun blindIndex(m: CryptoModule): BlindIndex = m.blindIndex
    @Bean fun objectCipher(m: CryptoModule): ObjectCipher = m.objects
    @Bean fun secureTokens(m: CryptoModule): SecureTokens = m.tokens
    @Bean fun keyRotation(m: CryptoModule): KeyRotation = m.rotation
    @Bean fun passwordHasher(m: CryptoModule): PasswordHasher = m.passwords
    @Bean fun migrationCrypto(m: CryptoModule): MigrationCrypto = m.migration
    @Bean fun tokenSigner(m: CryptoModule): TokenSigner = m.jwt

    @Bean
    fun encryptionInterceptor(m: CryptoModule) =
        HibernatePropertiesCustomizer { it["hibernate.session_factory.interceptor"] = m.interceptor }
}

/** Startup checks 3-5 (architecture §9.2): runs before the bucket and Admin runners; a failure stops the boot. */
@Component
@Order(1)
class CryptoSelfTest(private val m: CryptoModule, private val db: DataSource) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        db.connection.use { m.rotation.requireConfigured(it) }
        m.selfTest()
    }
}
