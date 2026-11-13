package co.klei.download;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest
@AutoConfigureMockMvc
class DownloadSiteTest {
    static final String TOKEN = "Zk3_tU9vQ1wXb7LmN0pRsD4eHgYa6CjF2iOq8VnTx5A";
    static final Path DATA = data();

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("klei.download.path-token", () -> TOKEN);
        r.add("klei.download.path-token-file", () -> "");
        r.add("klei.download.data-dir", DATA::toString);
    }

    @Autowired MockMvc mvc;

    static Path data() {
        try {
            Path d = Files.createTempDirectory("klei-dl");
            release(d, "1.2.0", "a.dmg", 3, false); // names a file that is absent: not listed
            release(d, "1.9.0", "a.dmg", 5, true);
            release(d, "1.10.0", "a.dmg", 7, true);
            release(d, "1.11.0", "a.dmg", 9, true);
            Files.writeString(d.resolve("1.11.0/release.json"), "{ not json"); // malformed: not listed
            Files.writeString(d.resolve("1.10.0/extra.bin"), "x");              // in folder, not in manifest
            release(d, ".1.12.0.part", "a.dmg", 1, true);                       // upload in progress
            return d;
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    static void release(Path d, String version, String file, int size, boolean write) throws IOException {
        Path v = Files.createDirectories(d.resolve(version));
        if (write) Files.write(v.resolve(file), new byte[size]);
        Files.writeString(v.resolve("release.json"), """
                {"version":"%s","pubDate":"2026-11-14T00:00:00Z","channel":"preview","files":[
                 {"name":"%s","os":"macos","arch":"arm64","kind":"dmg","size":%d,"sha256":"%s"}]}
                """.formatted(version.replace(".part", "").replaceFirst("^\\.", ""), file, size, "a".repeat(64)));
    }

    ResultActions emptyNotFound(String uri) throws Exception {
        return mvc.perform(get(URI.create(uri))).andExpect(status().isNotFound()).andExpect(content().string(""));
    }

    @Test
    void startupRefusesBadTokenWithoutEchoingIt() {
        for (String bad : new String[] {"", "short", "a".repeat(42), "a".repeat(43) + "!", "a".repeat(40) + "/.."}) {
            var e = assertThrows(IllegalStateException.class, () -> TokenGate.resolve(bad, ""));
            assertFalse(!bad.isEmpty() && e.getMessage().contains(bad));
        }
        assertThrows(IllegalStateException.class, () -> TokenGate.resolve("", "/no/such/file"));
        assertEquals(TOKEN, TokenGate.resolve(TOKEN, ""));
    }

    @Test
    void everythingOutsideTheTokenIsAnEmptyNotFound() throws Exception {
        for (String p : new String[] {"/", "/robots.txt", "/error", "/actuator/health", "/favicon.ico",
                "/" + TOKEN.substring(1), "/" + TOKEN + "x", "/" + TOKEN.replace('Z', 'z') + "/",
                "/" + TOKEN + "/nope", "/" + TOKEN + "/files/1.10.0/", "/" + TOKEN + "/static/x.js"}) {
            emptyNotFound(p).andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(header().string("Referrer-Policy", "no-referrer"));
        }
        mvc.perform(post("/" + TOKEN + "/")).andExpect(status().isNotFound()).andExpect(content().string(""));
    }

    @Test
    void tokenPathHasNoRedirect() throws Exception {
        mvc.perform(get("/" + TOKEN)).andExpect(status().isOk());
        mvc.perform(get("/" + TOKEN + "/")).andExpect(status().isOk());
    }

    @Test
    void pageListsSemverNewestFirstAndHidesBrokenVersions() throws Exception {
        String html = mvc.perform(get("/" + TOKEN + "/")).andExpect(status().isOk())
                .andExpect(header().string("X-Robots-Tag", "noindex, nofollow, noarchive"))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("Content-Security-Policy",
                        "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"))
                .andExpect(header().doesNotExist("Set-Cookie"))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8);
        int a = html.indexOf("1.10.0"), b = html.indexOf("1.9.0");
        assertFalse(a < 0 || b < 0 || a > b, "1.10.0 must come before 1.9.0");
        assertFalse(html.contains("1.2.0") || html.contains("1.11.0") || html.contains("1.12.0"));
        assertFalse(html.contains("<script"));
        assertFalse(html.contains(TOKEN + "/files/1.10.0/extra.bin"));
        assertFalse(html.contains("http://") || html.contains("https://"));
    }

    @Test
    void latestJsonCarriesExactlyVersionAndPubDate() throws Exception {
        mvc.perform(get("/" + TOKEN + "/latest.json")).andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/json"))
                .andExpect(content().string("{\"version\":\"1.10.0\",\"pubDate\":\"2026-11-14T00:00:00Z\"}"));
    }

    @Test
    void streamsListedFileOnlyAsAttachment() throws Exception {
        mvc.perform(get("/" + TOKEN + "/files/1.10.0/a.dmg")).andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"a.dmg\""))
                .andExpect(header().string("Content-Type", "application/octet-stream"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().bytes(new byte[7]));
        for (String p : new String[] {"/files/1.10.0/extra.bin", "/files/1.2.0/a.dmg", "/files/1.11.0/a.dmg",
                "/files/.1.12.0.part/a.dmg", "/files/1.10.0/release.json", "/files/1.10.0/..%2Fa.dmg",
                "/files/1.10.0/%2e%2e", "/files/..%2F1.9.0/a.dmg", "/files/1.10.0/a%5Cdmg", "/files/1.10.0/%2Fetc%2Fpasswd"}) {
            mvc.perform(get(URI.create("/" + TOKEN + p))).andExpect(status().is4xxClientError());
        }
    }
}
