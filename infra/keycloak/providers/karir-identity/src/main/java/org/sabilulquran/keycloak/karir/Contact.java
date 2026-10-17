package org.sabilulquran.keycloak.karir;

import java.util.regex.Pattern;

/**
 * WhatsApp number normalisation and masking. Mirrors karir-sq {@code apps/api/src/lib/phone.ts}.
 */
public final class Contact {
    private static final Pattern IGNORED = Pattern.compile("[\\s().-]");
    private static final Pattern DIGITS = Pattern.compile("\\d+");
    private static final Pattern INDONESIAN_MOBILE = Pattern.compile("628\\d{7,11}");
    private static final String BULLET = "•";

    private Contact() {
    }

    /** Returns E.164 digits without "+" ({@code 628...}), or {@code null}. Accepts 08..., 8..., 628..., +62.... */
    public static String normalizeWaNumber(String input) {
        if (input == null) {
            return null;
        }
        String digits = IGNORED.matcher(input.strip()).replaceAll("");
        if (digits.startsWith("+")) {
            digits = digits.substring(1);
        }
        if (!DIGITS.matcher(digits).matches()) {
            return null;
        }
        if (digits.startsWith("0")) {
            digits = "62" + digits.substring(1);
        } else if (digits.startsWith("8")) {
            digits = "62" + digits;
        }
        return INDONESIAN_MOBILE.matcher(digits).matches() ? digits : null;
    }

    /** {@code 6281234567890} becomes {@code 0812••••••890}. */
    public static String maskWaNumber(String e164) {
        String local = e164.startsWith("62") ? "0" + e164.substring(2) : e164;
        return local.substring(0, 4) + BULLET.repeat(Math.max(local.length() - 7, 3)) + local.substring(local.length() - 3);
    }

    /** {@code nama@contoh.id} becomes {@code n•••••@contoh.id}. */
    public static String maskEmail(String email) {
        int at = email.indexOf('@');
        if (at < 1) {
            return BULLET.repeat(3);
        }
        return email.charAt(0) + BULLET.repeat(5) + email.substring(at);
    }
}
