package org.sabilulquran.keycloak.karir;

import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import org.jboss.logging.Logger;

/**
 * Process-wide state shared by every component of the provider: configuration, HTTP clients and rate limiters.
 * Rate limits must be shared across login, registration and reset, so they cannot live in one factory.
 */
public final class KarirRuntime {
    private static final Logger LOG = Logger.getLogger(KarirRuntime.class);
    private static volatile KarirRuntime instance;

    private final KarirConfig config;
    private final AbuseGuard abuseGuard;
    private final TurnstileVerifier turnstile;
    private final OtpDeliveryClient delivery;
    private final Clock clock;

    KarirRuntime(KarirConfig config, Clock clock) {
        this.config = config;
        this.clock = clock;
        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.abuseGuard = new AbuseGuard(clock);
        this.turnstile = new TurnstileVerifier(http, config.turnstileVerifyUrl(), config.turnstileSecret());
        this.delivery = new OtpDeliveryClient(http, config.relayUrl(), config.relaySecret(), clock);
    }

    public static KarirRuntime get() {
        KarirRuntime current = instance;
        if (current == null) {
            synchronized (KarirRuntime.class) {
                current = instance;
                if (current == null) {
                    KarirConfig config = KarirConfig.fromEnvironment(System.getenv());
                    LOG.infof("Karir identity provider configured: %s", config);
                    current = new KarirRuntime(config, Clock.systemUTC());
                    instance = current;
                }
            }
        }
        return current;
    }

    public KarirConfig config() {
        return config;
    }

    public AbuseGuard abuseGuard() {
        return abuseGuard;
    }

    public TurnstileVerifier turnstile() {
        return turnstile;
    }

    public OtpDeliveryClient delivery() {
        return delivery;
    }

    public Clock clock() {
        return clock;
    }
}
