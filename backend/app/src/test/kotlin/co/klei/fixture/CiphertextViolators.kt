package co.klei.fixture

import co.klei.crypto.EncryptedEntity
import org.springframework.data.jpa.repository.Query
import org.springframework.jdbc.core.JdbcTemplate

/** Deliberate violations of AD-19. Never scanned by Spring: outside co.klei.app. */
interface RawRepo {
    @Query("update CryptoProbe p set p.nameCt = :b where p.id = :id")
    fun overwrite(): Int
}

class RawWriter(private val jdbc: JdbcTemplate) {
    fun poke() = jdbc.update("update crypto_probe set name_ct = null")
}

@EncryptedEntity("fixture")
data class LeakyEntity(val name: String)
