package co.klei.download;

import java.io.IOException;
import org.apache.catalina.connector.Request;
import org.apache.catalina.connector.Response;
import org.apache.catalina.core.StandardHost;
import org.apache.catalina.valves.ErrorReportValve;
import org.springframework.boot.tomcat.servlet.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.stereotype.Component;

/**
 * Tomcat rejects some requests (an encoded slash, a bad URI) before any filter runs and answers with its own HTML page.
 * Replace that page with the same empty 404 and headers as every other miss.
 */
@Component
class TomcatEmptyErrors implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {
    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        factory.addContextCustomizers(ctx -> {
            if (ctx.getParent() instanceof StandardHost host) host.setErrorReportValveClass(Empty.class.getName());
        });
    }

    public static class Empty extends ErrorReportValve {
        @Override
        protected void report(Request request, Response response, Throwable throwable) {
            if (response.isCommitted()) return;
            response.setStatus(404);
            response.setHeader("Referrer-Policy", "no-referrer");
            response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.setHeader("Cache-Control", "no-store");
            response.setHeader("Content-Security-Policy",
                    "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
            response.setContentLength(0);
        }
    }
}
