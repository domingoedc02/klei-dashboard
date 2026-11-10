package co.klei.app.away

import co.klei.crypto.Encrypted
import co.klei.crypto.EncryptedEntity
import co.klei.crypto.EncryptedEntityBase
import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import jakarta.persistence.Transient
import jakarta.persistence.Version
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

/** When the studio is closed (FR-32). Also the API shape. `mode` is `once`, `weekly` or `daily`; [days] are `mon`..`sun`, dates `2026-11-26`, times `18:00`. */
@Serializable
data class AwaySchedule(
    val mode: String = "weekly",
    val days: List<String> = emptyList(),
    val start: String? = null,
    val end: String? = null,
    val from: String? = null,
    val to: String? = null,
)

/** The stored envelope: `v` is the schema version the field codec requires; [zone] is the Admin's time zone when the schedule was saved. */
@Serializable
class AwayStored(val v: Int = 1, val schedule: AwaySchedule, val zone: String)

/** The one away message (FR-32). One row, fixed id, one Admin editor. */
@Entity
@Table(name = "away")
@EncryptedEntity("away")
class Away(@Id val id: UUID, enabled: Boolean, message: String, schedule: AwayStored) : EncryptedEntityBase() {
    @Version var version: Long? = null

    @Transient @Encrypted("enabled") var enabled: Boolean = enabled
    @Transient @Encrypted("message") var message: String = message
    @Transient @Encrypted("schedule") var schedule: AwayStored = schedule

    internal var enabledCt: ByteArray? = null
    internal var messageCt: ByteArray? = null
    internal var scheduleCt: ByteArray? = null
}

/** A client who was sent the away message for the closure window that began at [windowStart]. */
@Entity
@Table(name = "away_sent")
@EncryptedEntity("away_sent")
class AwaySent(@Id val id: UUID, @Column(name = "client_id") val clientId: UUID, windowStart: Instant) : EncryptedEntityBase() {
    @Transient @Encrypted("window_start") var windowStart: Instant = windowStart

    internal var windowStartCt: ByteArray? = null
}
