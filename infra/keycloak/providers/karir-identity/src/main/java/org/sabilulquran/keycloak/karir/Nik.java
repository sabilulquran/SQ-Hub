package org.sabilulquran.keycloak.karir;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.HexFormat;
import java.util.Set;
import java.util.regex.Pattern;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * NIK normalisation and hashing. Mirrors karir-sq {@code apps/api/src/lib/nik.ts} exactly, because both sides must
 * compute the same {@code nik_hmac} for the same person (REC-IMPL-001 §2, §4.2).
 *
 * <p>The NIK itself never leaves this class except as the HMAC; callers must not log, store or echo it.
 */
public final class Nik {
    private static final Set<String> PROVINCE_CODES = Set.of(
            "11", "12", "13", "14", "15", "16", "17", "18", "19",
            "21",
            "31", "32", "33", "34", "35", "36",
            "51", "52", "53",
            "61", "62", "63", "64", "65",
            "71", "72", "73", "74", "75", "76",
            "81", "82",
            "91", "92", "93", "94", "95", "96");
    private static final Pattern IGNORED = Pattern.compile("[\\s.-]");
    private static final Pattern SIXTEEN_DIGITS = Pattern.compile("\\d{16}");
    private static final Pattern ONE_REPEATED_DIGIT = Pattern.compile("(\\d)\\1{15}");

    private Nik() {
    }

    /** Returns the 16-digit NIK, or {@code null} when the input cannot be a valid NIK. */
    public static String normalize(String input) {
        if (input == null) {
            return null;
        }
        String raw = IGNORED.matcher(input.strip()).replaceAll("");
        if (!SIXTEEN_DIGITS.matcher(raw).matches()) {
            return null;
        }
        if (!PROVINCE_CODES.contains(raw.substring(0, 2))) {
            return null;
        }
        if (ONE_REPEATED_DIGIT.matcher(raw).matches()) {
            return null;
        }
        return raw;
    }

    /** HMAC-SHA256 of the normalised NIK, lowercase hex. The pepper is shared with Karir SQ. */
    public static String hmac(String pepper, String normalizedNik) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(pepper.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(("nik:v1:" + normalizedNik).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HmacSHA256 is unavailable", failure);
        }
    }
}
