package co.klei.download;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/** Reads the data directory on every call: a published version appears, and a deleted one vanishes, with no restart. */
@Component
class ReleaseStore {
    private static final Pattern NAME = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    private static final Pattern KIND = Pattern.compile("[A-Za-z0-9.]{1,16}");
    private static final Pattern SHA256 = Pattern.compile("[0-9a-f]{64}");
    private static final Set<String> OS = Set.of("macos", "windows", "linux");
    private static final Set<String> ARCH = Set.of("arm64", "x64");

    private final Path root;
    private final JsonMapper json = JsonMapper.builder().build();

    ReleaseStore(@Value("${klei.download.data-dir}") String dir) {
        this.root = Path.of(dir);
    }

    /** Listed versions, newest first. */
    List<Release> list() {
        try (var dirs = Files.list(root)) {
            return dirs.map(d -> d.getFileName().toString())
                    .map(this::load)
                    .flatMap(Optional::stream)
                    .sorted((a, b) -> Release.compare(b.version(), a.version()))
                    .toList();
        } catch (IOException e) {
            return List.of();
        }
    }

    /** A version is listed only if its manifest is well-formed and every file it names is present at the stated size. */
    Optional<Release> load(String version) {
        if (!Release.VERSION.matcher(version).matches()) return Optional.empty(); // also drops ".<v>.part" uploads
        Path dir = root.resolve(version);
        try {
            Release r = json.readValue(dir.resolve("release.json").toFile(), Release.class);
            return valid(r, version, dir) ? Optional.of(r) : Optional.empty();
        } catch (Exception e) { // shortcut: any malformed field (null, bad date, bad JSON) hides the version, never serves it
            return Optional.empty();
        }
    }

    Path path(String version, String name) {
        return root.resolve(version).resolve(name);
    }

    private boolean valid(Release r, String version, Path dir) throws IOException {
        OffsetDateTime.parse(r.pubDate());
        if (!version.equals(r.version()) || !"preview".equals(r.channel()) || r.files().isEmpty()) return false;
        var seen = new HashSet<String>();
        for (Release.Item f : r.files()) {
            if (!NAME.matcher(f.name()).matches() || f.name().equals("release.json") || !seen.add(f.name())) return false;
            if (!OS.contains(f.os()) || !ARCH.contains(f.arch())) return false;
            if (!KIND.matcher(f.kind()).matches() || !SHA256.matcher(f.sha256()).matches()) return false;
            Path p = dir.resolve(f.name());
            if (!Files.isRegularFile(p, LinkOption.NOFOLLOW_LINKS) || Files.size(p) != f.size()) return false;
        }
        return true;
    }
}
