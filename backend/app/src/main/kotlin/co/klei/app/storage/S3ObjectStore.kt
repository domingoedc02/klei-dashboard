package co.klei.app.storage

import co.klei.core.storage.ListedObject
import co.klei.core.storage.ObjectStorePort
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Component
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.S3Client
import software.amazon.awssdk.services.s3.S3Configuration
import software.amazon.awssdk.services.s3.model.BucketAlreadyOwnedByYouException
import software.amazon.awssdk.services.s3.model.NoSuchBucketException
import software.amazon.awssdk.services.s3.model.NoSuchKeyException
import java.net.URI
import java.util.UUID

/** Path-style S3 adapter (SeaweedFS). */
@Component
class S3ObjectStore(
    @Value("\${klei.s3.endpoint}") endpoint: String,
    @Value("\${klei.s3.access-key}") accessKey: String,
    @Value("\${klei.s3.secret-key}") secretKey: String,
    @Value("\${klei.s3.bucket}") private val bucket: String,
) : ObjectStorePort, AutoCloseable {
    private val log = LoggerFactory.getLogger(S3ObjectStore::class.java)

    private val client: S3Client = S3Client.builder()
        .endpointOverride(URI.create(endpoint))
        .region(Region.US_EAST_1)
        .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(accessKey, secretKey)))
        .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
        .build()

    override fun ensureBucket() {
        try {
            client.headBucket { it.bucket(bucket) }
        } catch (_: NoSuchBucketException) {
            try {
                client.createBucket { it.bucket(bucket) }
                log.info("object store bucket created")
            } catch (_: BucketAlreadyOwnedByYouException) {
                // created by a concurrent start
            }
        }
    }

    override fun isReachable(): Boolean = runCatching { client.headBucket { it.bucket(bucket) } }.isSuccess

    override fun put(key: UUID, body: ByteArray) {
        client.putObject({ it.bucket(bucket).key(key.toString()).contentType("application/octet-stream") }, RequestBody.fromBytes(body))
    }

    override fun get(key: UUID): ByteArray? = try {
        client.getObjectAsBytes { it.bucket(bucket).key(key.toString()) }.asByteArray()
    } catch (_: NoSuchKeyException) {
        null
    }

    override fun delete(key: UUID) {
        client.deleteObject { it.bucket(bucket).key(key.toString()) }
    }

    override fun list(): List<ListedObject> =
        client.listObjectsV2Paginator { it.bucket(bucket) }.contents().map { ListedObject(it.key(), it.lastModified()) }

    override fun close() = client.close()
}
