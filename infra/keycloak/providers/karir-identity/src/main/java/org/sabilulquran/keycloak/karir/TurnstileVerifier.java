package org.sabilulquran.keycloak.karir;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import org.jboss.logging.Logger;
import org.keycloak.util.JsonSerialization;

/** Server-side Cloudflare Turnstile check. Any error is a failed check (fail closed). */
public class TurnstileVerifier {
    public static final String FORM_FIELD = "cf-turnstile-response";
    private static final Logger LOG = Logger.getLogger(TurnstileVerifier.class);
    private static final int MAX_TOKEN_LENGTH = 2048;

    private final HttpClient http;
    private final URI verifyUrl;
    private final String secret;

    public TurnstileVerifier(HttpClient http, URI verifyUrl, String secret) {
        this.http = http;
        this.verifyUrl = verifyUrl;
        this.secret = secret;
    }

    public boolean verify(String token, String remoteIp) {
        if (secret == null || verifyUrl == null) {
            LOG.warn("Turnstile is required but not configured; rejecting the request");
            return false;
        }
        if (token == null || token.isBlank() || token.length() > MAX_TOKEN_LENGTH) {
            return false;
        }
        StringBuilder body = new StringBuilder()
                .append("secret=").append(encode(secret))
                .append("&response=").append(encode(token));
        if (remoteIp != null) {
            body.append("&remoteip=").append(encode(remoteIp));
        }
        HttpRequest request = HttpRequest.newBuilder(verifyUrl)
                .timeout(Duration.ofSeconds(5))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body.toString()))
                .build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                LOG.warnf("Turnstile verification returned HTTP %d", response.statusCode());
                return false;
            }
            Map<?, ?> json = JsonSerialization.readValue(response.body(), Map.class);
            return Boolean.TRUE.equals(json.get("success"));
        } catch (IOException failure) {
            LOG.warn("Turnstile verification failed: " + failure.getClass().getSimpleName());
            return false;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
