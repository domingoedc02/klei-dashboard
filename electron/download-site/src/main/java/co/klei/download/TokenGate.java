package co.klei.download;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Every route lives under /{token}. Anything else, or any method but GET/HEAD, is an empty 404 with the same headers. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class TokenGate extends OncePerRequestFilter {
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_-]{43,}");

    private final byte[] token;

    TokenGate(@Value("${klei.download.path-token:}") String inline,
              @Value("${klei.download.path-token-file:}") String file) {
        this.token = resolve(inline, file).getBytes(StandardCharsets.US_ASCII);
    }

    /** Throws without echoing the value. */
    static String resolve(String inline, String file) {
        String value = inline;
        if (file != null && !file.isBlank()) {
            try {
                value = Files.readString(Path.of(file)).strip();
            } catch (IOException e) {
                throw new IllegalStateException("KLEI_DOWNLOAD_PATH_TOKEN_FILE is not readable");
            }
        }
        if (value == null || !TOKEN.matcher(value).matches()) {
            throw new IllegalStateException(
                    "KLEI_DOWNLOAD_PATH_TOKEN is missing or invalid: need 43 or more characters from A-Z a-z 0-9 _ -");
        }
        return value;
    }

    static void apply(HttpServletResponse res) {
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Security-Policy",
                "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        apply(res);
        if (!allowed(req)) {
            res.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        chain.doFilter(req, res);
    }

    private boolean allowed(HttpServletRequest req) {
        String method = req.getMethod();
        if (!method.equals("GET") && !method.equals("HEAD")) return false;
        String uri = req.getRequestURI(); // raw, not decoded
        int n = token.length;
        if (uri.length() < n + 1 || uri.charAt(0) != '/') return false;
        byte[] segment = uri.substring(1, n + 1).getBytes(StandardCharsets.US_ASCII);
        // shortcut: a short or long token length is not hidden, only its value; add a fixed-length hash compare if that ever matters
        boolean equal = MessageDigest.isEqual(segment, token);
        return equal && (uri.length() == n + 1 || uri.charAt(n + 1) == '/');
    }
}
