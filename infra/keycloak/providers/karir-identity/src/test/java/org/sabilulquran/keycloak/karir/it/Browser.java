package org.sabilulquran.keycloak.karir.it;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * A minimal browser: one cookie jar, one client IP (X-Forwarded-For), manual redirects, HTML forms. The jar is
 * hand-made because Keycloak marks its cookies Secure, which java.net.CookieManager will not send over http.
 */
final class Browser {
    record Page(int status, URI uri, String location, String html, Document document) {
        String text() {
            return document == null ? "" : document.text();
        }

        boolean has(String selector) {
            return document != null && document.selectFirst(selector) != null;
        }

        Element form(String selector) {
            Element form = document == null ? null : document.selectFirst(selector);
            if (form == null) {
                throw new AssertionError("form " + selector + " not on page " + uri + ": " + text());
            }
            return form;
        }
    }

    private final HttpClient http;
    private final String clientIp;
    private final Map<String, String> cookies = new LinkedHashMap<>();

    Browser(String clientIp) {
        this.clientIp = clientIp;
        this.http = HttpClient.newBuilder()
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    Page get(String url) {
        return send(HttpRequest.newBuilder(URI.create(url)).GET());
    }

    Page submit(Page page, String formSelector, Map<String, String> fields) {
        Element form = page.form(formSelector);
        String action = form.absUrl("action").isEmpty() ? form.attr("action") : form.absUrl("action");
        return post(action, fields);
    }

    Page post(String url, Map<String, String> fields) {
        String body = fields.entrySet().stream()
                .map(e -> encode(e.getKey()) + "=" + encode(e.getValue()))
                .collect(Collectors.joining("&"));
        return send(HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)));
    }

    /** Follows redirects inside Keycloak; stops at a redirect to another origin (the client callback). */
    Page follow(Page page, String keycloakBaseUrl) {
        Page current = page;
        for (int i = 0; i < 10 && current.location() != null; i++) {
            String next = current.uri().resolve(current.location()).toString();
            if (!next.startsWith(keycloakBaseUrl)) {
                return current;
            }
            current = get(next);
        }
        return current;
    }

    static Map<String, String> fields(String... keyValues) {
        Map<String, String> map = new LinkedHashMap<>();
        for (int i = 0; i < keyValues.length; i += 2) {
            map.put(keyValues[i], keyValues[i + 1]);
        }
        return map;
    }

    private Page send(HttpRequest.Builder builder) {
        try {
            if (!cookies.isEmpty()) {
                builder.header("Cookie", cookies.entrySet().stream()
                        .map(e -> e.getKey() + "=" + e.getValue()).collect(Collectors.joining("; ")));
            }
            HttpRequest request = builder
                    .header("X-Forwarded-For", clientIp)
                    .header("Accept-Language", "id")
                    .timeout(Duration.ofSeconds(60))
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            remember(response.headers().allValues("Set-Cookie"));
            String location = response.headers().firstValue("Location").orElse(null);
            String type = response.headers().firstValue("Content-Type").orElse("");
            Document document = type.contains("html") ? Jsoup.parse(response.body(), request.uri().toString()) : null;
            return new Page(response.statusCode(), request.uri(), location, response.body(), document);
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(interrupted);
        }
    }

    private void remember(List<String> setCookies) {
        for (String header : setCookies) {
            String pair = header.split(";", 2)[0];
            int eq = pair.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            String name = pair.substring(0, eq).strip();
            String value = pair.substring(eq + 1).strip();
            String lower = header.toLowerCase();
            if (value.isEmpty() || lower.contains("max-age=0") || lower.contains("expires=thu, 01 jan 1970")) {
                cookies.remove(name);
            } else {
                cookies.put(name, value);
            }
        }
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
