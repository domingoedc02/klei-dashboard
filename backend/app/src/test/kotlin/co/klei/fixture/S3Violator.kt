package co.klei.fixture

import software.amazon.awssdk.services.s3.S3Client

/** Deliberate violation: the S3 client outside `co.klei.app.storage`. Only the negative architecture test reads this package. */
class S3Violator(val client: S3Client)
