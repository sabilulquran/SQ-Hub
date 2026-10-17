package org.sabilulquran.keycloak.karir;

import org.keycloak.Config;
import org.keycloak.events.EventListenerProvider;
import org.keycloak.events.EventListenerProviderFactory;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;

public final class KarirEventListenerFactory implements EventListenerProviderFactory {
    public static final String PROVIDER_ID = "karir-event-listener";
    private static final KarirEventListener SINGLETON = new KarirEventListener();

    @Override
    public EventListenerProvider create(KeycloakSession session) {
        return SINGLETON;
    }

    @Override
    public void init(Config.Scope config) {
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
        // Read the environment once at start-up so a missing secret shows in the startup log.
        for (IdentityProfile profile : IdentityProfile.values()) {
            KarirRuntime.forProfile(profile);
        }
    }

    @Override
    public void close() {
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }
}
