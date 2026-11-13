package co.klei.download;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** One `<version>/release.json`, as written by the release workflow (story 19.4). */
public record Release(String version, String pubDate, String channel, List<Item> files) {

    public record Item(String name, String os, String arch, String kind, long size, String sha256) {
        public String osLabel() {
            return switch (os) {
                case "macos" -> "macOS";
                case "windows" -> "Windows 11";
                default -> "Ubuntu 24.04";
            };
        }

        public String archLabel() {
            if (!os.equals("macos")) return arch;
            return arch.equals("arm64") ? "Apple silicon (arm64)" : "Intel (x64)";
        }

        public String sizeLabel() {
            return String.format(Locale.ROOT, "%.1f MB", size / 1048576.0);
        }
    }

    static final Pattern VERSION = Pattern.compile(
            "(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})"
                    + "(-(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*))*)?");

    public String date() {
        return OffsetDateTime.parse(pubDate).toLocalDate().toString();
    }

    /** Semver 2.0 precedence for versions already matched by {@link #VERSION}. */
    static int compare(String a, String b) {
        String[] x = a.split("-", 2), y = b.split("-", 2);
        String[] p = x[0].split("\\."), q = y[0].split("\\.");
        for (int i = 0; i < 3; i++) {
            int c = Long.compare(Long.parseLong(p[i]), Long.parseLong(q[i]));
            if (c != 0) return c;
        }
        if (x.length == 1 || y.length == 1) return Integer.compare(y.length, x.length);
        String[] s = x[1].split("\\."), t = y[1].split("\\.");
        for (int i = 0; i < Math.min(s.length, t.length); i++) {
            boolean n = s[i].matches("\\d+"), m = t[i].matches("\\d+");
            int c = n && m ? new BigInteger(s[i]).compareTo(new BigInteger(t[i])) : n ? -1 : m ? 1 : s[i].compareTo(t[i]);
            if (c != 0) return c;
        }
        return Integer.compare(s.length, t.length);
    }
}
