package co.klei.download;

import java.io.IOException;
import java.io.UncheckedIOException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.ResponseBody;

/** The token is checked by {@link TokenGate} before any of these run; the path variable is only used to build links. */
@Controller
class SiteController {
    public record Latest(String version, String pubDate) {}

    private final ReleaseStore store;

    SiteController(ReleaseStore store) {
        this.store = store;
    }

    @GetMapping({"/{token}", "/{token}/"})
    String index(@PathVariable String token, Model model) {
        model.addAttribute("token", token); // links are absolute paths, so they work with or without the trailing slash
        model.addAttribute("releases", store.list());
        return "index";
    }

    @GetMapping(value = "/{token}/latest.json", produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseBody
    ResponseEntity<Latest> latest() {
        return store.list().stream().findFirst()
                .map(r -> ResponseEntity.ok(new Latest(r.version(), r.pubDate())))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping("/{token}/files/{version}/{name}")
    ResponseEntity<Resource> file(@PathVariable String version, @PathVariable String name) {
        return store.load(version)
                .filter(r -> r.files().stream().anyMatch(f -> f.name().equals(name)))
                .map(r -> ResponseEntity.ok()
                        .contentType(MediaType.APPLICATION_OCTET_STREAM)
                        .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(name).build().toString())
                        .<Resource>body(new FileSystemResource(store.path(version, name))))
                .orElseGet(() -> ResponseEntity.notFound().build());
    }

    @GetMapping(value = "/{token}/static/site.css", produces = "text/css")
    @ResponseBody
    String css() {
        try {
            return new ClassPathResource("static/site.css").getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
