package co.klei.app.upload

import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.annotation.Order
import org.springframework.stereotype.Component

/** A run dies with its process, so a Batch still `processing` at boot becomes `error` code `interrupted` and the User can Retry. */
@Component
@Order(4)
class GroupingRecovery(private val grouping: GroupingService) : ApplicationRunner {
    override fun run(args: ApplicationArguments) = grouping.markInterrupted()
}
