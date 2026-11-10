package co.klei.app.web

import org.apache.catalina.connector.Connector
import org.springframework.beans.factory.annotation.Value
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory
import org.springframework.boot.web.server.WebServerFactoryCustomizer
import org.springframework.stereotype.Component

/** AD-1: one Tomcat, two connectors. 8080 is the API, `klei.auth-port` (8081) is Auth Web. */
@Component
class AuthConnectorCustomizer(@Value("\${klei.auth-port}") private val authPort: Int) :
    WebServerFactoryCustomizer<TomcatServletWebServerFactory> {

    override fun customize(factory: TomcatServletWebServerFactory) {
        val connector = Connector("org.apache.coyote.http11.Http11NioProtocol").apply { port = authPort }
        factory.addAdditionalConnectors(connector)
    }
}
