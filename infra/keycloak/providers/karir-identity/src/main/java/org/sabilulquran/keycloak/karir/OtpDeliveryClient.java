package org.sabilulquran.keycloak.karir;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.jboss.logging.Logger;
import org.keycloak.email.EmailException;
import org.keycloak.email.EmailSenderProvider;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.RealmModel;
import org.keycloak.models.UserModel;

/**
 * Delivers one-time codes (REC-IMPL-001 §4.3). WhatsApp goes through the loopback, HMAC-signed Karir SQ relay
 * {@code POST /internal/otp-deliveries}; email goes through the realm SMTP. The code is never logged.
 */
public class OtpDeliveryClient {
    public enum Result { SENT, RATE_LIMITED, FAILED }

    public enum Purpose {
        VERIFY("verify"), RESET("reset");

        final String wire;

        Purpose(String wire) {
            this.wire = wire;
        }
    }

    static final String EMAIL_SUBJECT = IdentityProfile.KARIR.emailSubject();
    private static final Logger LOG = Logger.getLogger(OtpDeliveryClient.class);

    private final HttpClient http;
    private final URI relayUrl;
    private final String relaySecret;
    private final Clock clock;
    private final IdentityProfile profile;

    public OtpDeliveryClient(HttpClient http, URI relayUrl, String relaySecret, Clock clock) {
        this(http, relayUrl, relaySecret, clock, IdentityProfile.KARIR);
    }

    public OtpDeliveryClient(HttpClient http, URI relayUrl, String relaySecret, Clock clock, IdentityProfile profile) {
        this.http = http;
        this.relayUrl = relayUrl;
        this.relaySecret = relaySecret;
        this.clock = clock;
        this.profile = profile;
    }

    public Result sendWhatsApp(String to, String code, Purpose purpose) {
        if (relayUrl == null || relaySecret == null) {
            LOG.warn("WhatsApp OTP relay is not configured");
            return Result.FAILED;
        }
        String requestId = UUID.randomUUID().toString();
        String body = relayBody(to, code, purpose, requestId);
        String timestamp = Long.toString(clock.millis() / 1000);
        HttpRequest request = HttpRequest.newBuilder(relayUrl)
                // JalurPesan itself may take up to 15 s before the relay answers.
                .timeout(Duration.ofSeconds(20))
                .header("Content-Type", "application/json")
                .header(profile.relayHeaderPrefix() + "-Timestamp", timestamp)
                .header(profile.relayHeaderPrefix() + "-Signature", sign(relaySecret, timestamp, body))
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        try {
            HttpResponse<Void> response = http.send(request, HttpResponse.BodyHandlers.discarding());
            int status = response.statusCode();
            if (status == 202) {
                return Result.SENT;
            }
            LOG.warnf("WhatsApp OTP relay answered HTTP %d for request %s", status, requestId);
            return status == 429 ? Result.RATE_LIMITED : Result.FAILED;
        } catch (IOException failure) {
            LOG.warnf("WhatsApp OTP relay unreachable for request %s: %s", requestId, failure.getClass().getSimpleName());
            return Result.FAILED;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return Result.FAILED;
        }
    }

    public Result sendEmail(KeycloakSession session, RealmModel realm, UserModel user, String code) {
        Map<String, String> smtp = realm.getSmtpConfig();
        if (user.getEmail() == null || smtp == null || smtp.get("host") == null) {
            LOG.warn("Email OTP requested but the realm SMTP or the user email is missing");
            return Result.FAILED;
        }
        String text = profile.emailText(code);
        String html = "<p>" + text + "</p>";
        try {
            session.getProvider(EmailSenderProvider.class).send(smtp, user, profile.emailSubject(), text, html);
            return Result.SENT;
        } catch (EmailException failure) {
            LOG.warn("Email OTP delivery failed: " + failure.getClass().getSimpleName());
            return Result.FAILED;
        }
    }

    static String emailText(String code) {
        return IdentityProfile.KARIR.emailText(code);
    }

    /** Field order is fixed; every value is digits, a UUID or a fixed word, so no escaping is needed. */
    static String relayBody(String to, String code, Purpose purpose, String requestId) {
        if (!to.matches("\\d{8,15}") || !code.matches("\\d{6}")) {
            throw new IllegalArgumentException("invalid relay payload");
        }
        return "{\"channel\":\"whatsapp\",\"to\":\"" + to + "\",\"code\":\"" + code
                + "\",\"purpose\":\"" + purpose.wire + "\",\"requestId\":\"" + requestId + "\"}";
    }

    /** hex HMAC-SHA256(secret, timestamp + "." + raw body), as checked by Karir SQ. */
    static String sign(String secret, String timestamp, String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal((timestamp + "." + body).getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HmacSHA256 is unavailable", failure);
        }
    }
}
