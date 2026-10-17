package org.sabilulquran.keycloak.karir;

import java.net.URI;
import java.util.Map;

/**
 * Runtime configuration from the Keycloak process environment, like {@code SQ_TRUSTED_DEVICE_SIGNING_KEY}.
 * Missing secrets never fall back to a default: the affected step fails closed.
 *
 * @param nikPepper      {@code SQ_KARIR_NIK_PEPPER}, the same value as Karir SQ {@code NIK_HMAC_PEPPER}
 * @param relayUrl       {@code SQ_KARIR_OTP_RELAY_URL}, default loopback Karir SQ API
 * @param relaySecret    {@code SQ_KARIR_OTP_RELAY_SECRET}, the same value as Karir SQ {@code OTP_RELAY_SECRET}
 * @param turnstileSiteKey {@code SQ_KARIR_TURNSTILE_SITE_KEY}
 * @param turnstileSecret  {@code SQ_KARIR_TURNSTILE_SECRET}
 * @param turnstileVerifyUrl {@code SQ_KARIR_TURNSTILE_VERIFY_URL}, default Cloudflare siteverify
 */
public record KarirConfig(
        String nikPepper,
        URI relayUrl,
        String relaySecret,
        String turnstileSiteKey,
        String turnstileSecret,
        URI turnstileVerifyUrl) {

    static final URI DEFAULT_RELAY_URL = URI.create("http://127.0.0.1:3304/internal/otp-deliveries");
    static final URI DEFAULT_TURNSTILE_VERIFY_URL =
            URI.create("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    private static final int MIN_SECRET_LENGTH = 32;

    public static KarirConfig fromEnvironment(Map<String, String> env) {
        return new KarirConfig(
                secret(env.get("SQ_KARIR_NIK_PEPPER")),
                uri(env.get("SQ_KARIR_OTP_RELAY_URL"), DEFAULT_RELAY_URL),
                secret(env.get("SQ_KARIR_OTP_RELAY_SECRET")),
                blankToNull(env.get("SQ_KARIR_TURNSTILE_SITE_KEY")),
                blankToNull(env.get("SQ_KARIR_TURNSTILE_SECRET")),
                uri(env.get("SQ_KARIR_TURNSTILE_VERIFY_URL"), DEFAULT_TURNSTILE_VERIFY_URL));
    }

    public boolean nikLookupAvailable() {
        return nikPepper != null;
    }

    public boolean whatsAppRelayAvailable() {
        return relaySecret != null && relayUrl != null;
    }

    public boolean turnstileAvailable() {
        return turnstileSiteKey != null && turnstileSecret != null && turnstileVerifyUrl != null;
    }

    private static String secret(String value) {
        return value != null && value.length() >= MIN_SECRET_LENGTH ? value : null;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static URI uri(String value, URI fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            URI parsed = URI.create(value.strip());
            return "http".equals(parsed.getScheme()) || "https".equals(parsed.getScheme()) ? parsed : null;
        } catch (IllegalArgumentException invalid) {
            return null;
        }
    }

    @Override
    public String toString() {
        return "KarirConfig[nikLookup=" + nikLookupAvailable()
                + ", whatsAppRelay=" + whatsAppRelayAvailable()
                + ", turnstile=" + turnstileAvailable() + "]";
    }
}
