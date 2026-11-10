package co.klei.app

import co.klei.app.boot.StartupCheckException
import co.klei.app.boot.StartupChecks
import co.klei.crypto.KeyRingException
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication
import org.springframework.scheduling.annotation.EnableScheduling
import kotlin.system.exitProcess

@SpringBootApplication
@EnableScheduling
class KleiApplication

fun main(args: Array<String>) {
    try {
        StartupChecks.verify(System.getenv())
    } catch (e: StartupCheckException) {
        System.err.println("klei startup stopped: code=${e.code} variables=${e.variables.joinToString()}")
        exitProcess(1)
    }
    try {
        runApplication<KleiApplication>(*args)
    } catch (e: Exception) {
        // Startup check 3: a missing or wrong KEK stops the boot with the variable's name, never a value.
        val key = generateSequence<Throwable>(e) { it.cause }.filterIsInstance<KeyRingException>().firstOrNull() ?: throw e
        System.err.println("klei startup stopped: code=${key.code} variables=${key.variables.joinToString()}")
        exitProcess(1)
    }
}
