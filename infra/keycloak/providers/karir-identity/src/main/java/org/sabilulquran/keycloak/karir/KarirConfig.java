package org.sabilulquran.keycloak.karir;

import java.net.URI;
import java.util.Map;

/**
 * Runtime configuration from the Keycloak process environment, like {@code SQ_TRUSTED_DEVICE_SIGNING_KEY}.
 * Missing secrets never fall back to a default: the affected step fails closed.
 *
 * @param nikPepper      identifier pepper: {@code SQ_KARIR_NIK_PEPPER} (same as Karir SQ {@code NIK_HMAC_PEPPER}) or
 *                       {@code SQ_KELUARGA_KK_PEPPER} (same as Keluarga SQ); see {@link IdentityProfile#pepperVariable()}
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
        return fromEnvironment(env, IdentityProfile.KARIR);
    }

    /**
     * Reads the variables of one realm profile: {@code SQ_KARIR_*} for {@code sq-karir} and {@code SQ_KELUARGA_*}
     * for {@code sq-keluarga} (pepper {@code SQ_KELUARGA_KK_PEPPER}, default relay on Keluarga SQ port 3306).
     */
    public static KarirConfig fromEnvironment(Map<String, String> env, IdentityProfile profile) {
        String prefix = profile.envPrefix();
        return new KarirConfig(
                secret(env.get(profile.pepperVariable())),
                uri(env.get(prefix + "OTP_RELAY_URL"), profile.defaultRelayUrl()),
                secret(env.get(prefix + "OTP_RELAY_SECRET")),
                blankToNull(env.get(prefix + "TURNSTILE_SITE_KEY")),
                blankToNull(env.get(prefix + "TURNSTILE_SECRET")),
                uri(env.get(prefix + "TURNSTILE_VERIFY_URL"), DEFAULT_TURNSTILE_VERIFY_URL));
    }

    /** A configuration with every secret missing, so each step fails closed. */
    static KarirConfig unconfigured() {
        return new KarirConfig(null, null, null, null, null, null);
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
