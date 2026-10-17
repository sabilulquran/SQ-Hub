package org.sabilulquran.keycloak.karir;

import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;
import org.keycloak.events.Details;
import org.keycloak.events.Event;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.admin.AdminEvent;

/**
 * Event listener for realm {@code sq-karir} (REC-IMPL-001 §4.3). It replaces {@code jboss-logging} there: the log
 * line keeps the event type, client, user ID, error and an allow-list of details, and never the username or other
 * details. An event value that looks like an NIK is reported (without the value) so a leak is noticed.
 *
 * <p>Keycloak stores an event before listeners run, so this listener cannot change the stored event. Keeping the NIK
 * out of events is done where events are built: the provider never puts the NIK in an event.
 */
final class KarirEventListener implements EventListenerProvider {
    static final Set<String> LOGGED_DETAILS = Set.of(
            KarirEvents.DETAIL_CHANNEL,
            KarirEvents.DETAIL_PURPOSE,
            Details.CUSTOM_REQUIRED_ACTION,
            Details.REGISTER_METHOD,
            Details.AUTH_METHOD,
            Details.AUTH_TYPE);
    private static final Pattern NIK_LIKE = Pattern.compile("(?<![0-9A-Za-z])\\d{16}(?![0-9A-Za-z])");
    private static final Logger LOG = Logger.getLogger("org.sabilulquran.keycloak.karir.events");

    @Override
    public void onEvent(Event event) {
        Map<String, String> details = event.getDetails() == null ? Map.of() : event.getDetails();
        for (Map.Entry<String, String> entry : details.entrySet()) {
            if (looksLikeNik(entry.getValue())) {
                LOG.errorf("Karir event %s carries an NIK-like value in detail '%s' (value not logged)",
                        event.getType(), entry.getKey());
            }
        }
        if (looksLikeNik(event.getError())) {
            LOG.errorf("Karir event %s carries an NIK-like value in its error (value not logged)", event.getType());
        }
        Map<String, String> logged = new TreeMap<>();
        details.forEach((key, value) -> {
            if (LOGGED_DETAILS.contains(key) && !looksLikeNik(value)) {
                logged.put(key, value);
            }
        });
        if (event.getError() == null) {
            LOG.infof("type=%s clientId=%s userId=%s details=%s",
                    event.getType(), event.getClientId(), event.getUserId(), logged);
        } else {
            LOG.warnf("type=%s clientId=%s userId=%s error=%s details=%s",
                    event.getType(), event.getClientId(), event.getUserId(),
                    looksLikeNik(event.getError()) ? "redacted" : event.getError(), logged);
        }
    }

    @Override
    public void onEvent(AdminEvent event, boolean includeRepresentation) {
        if (includeRepresentation && looksLikeNik(event.getRepresentation())) {
            LOG.errorf("Karir admin event %s on %s carries an NIK-like value (value not logged)",
                    event.getOperationType(), event.getResourceType());
        }
    }

    static boolean looksLikeNik(String value) {
        return value != null && containsValidNik(value);
    }

    private static boolean containsValidNik(String value) {
        var matcher = NIK_LIKE.matcher(value);
        while (matcher.find()) {
            if (Nik.normalize(matcher.group()) != null) {
                return true;
            }
        }
        return false;
    }

    @Override
    public void close() {
    }
}
