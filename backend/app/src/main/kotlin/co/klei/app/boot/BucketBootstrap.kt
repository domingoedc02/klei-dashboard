package co.klei.app.boot

import co.klei.core.storage.ObjectStorePort
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component

/** Startup check 5 (part): the bucket exists, created when missing. A failure stops the boot. */
@Component
@Order(2)
class BucketBootstrap(private val store: ObjectStorePort) : ApplicationRunner {
    override fun run(args: ApplicationArguments) = store.ensureBucket()
}
