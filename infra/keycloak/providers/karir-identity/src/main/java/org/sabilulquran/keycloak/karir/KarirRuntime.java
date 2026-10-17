package org.sabilulquran.keycloak.karir;

import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import java.util.EnumMap;
import java.util.Map;
import org.jboss.logging.Logger;
import org.keycloak.models.RealmModel;

/**
 * Process-wide state per realm profile (KEL-IMPL-001 §4.5): configuration, HTTP clients and rate limiters.
 * Rate limits must be shared across login, registration and reset of one realm, so they cannot live in one factory;
 * each realm keeps its own counters. A realm without a profile gets an unconfigured runtime and fails closed.
 */
public final class KarirRuntime {
    private static final Logger LOG = Logger.getLogger(KarirRuntime.class);
    private static final Map<IdentityProfile, KarirRuntime> INSTANCES = new EnumMap<>(IdentityProfile.class);
    private static volatile KarirRuntime unconfigured;

    private final IdentityProfile profile;
    private final KarirConfig config;
    private final AbuseGuard abuseGuard;
    private final TurnstileVerifier turnstile;
    private final OtpDeliveryClient delivery;
    private final Clock clock;

    KarirRuntime(KarirConfig config, Clock clock) {
        this(IdentityProfile.KARIR, config, clock);
    }

    KarirRuntime(IdentityProfile profile, KarirConfig config, Clock clock) {
        this.profile = profile;
        this.config = config;
        this.clock = clock;
        HttpClient http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        this.abuseGuard = new AbuseGuard(clock);
        this.turnstile = new TurnstileVerifier(http, config.turnstileVerifyUrl(), config.turnstileSecret());
        this.delivery = new OtpDeliveryClient(http, config.relayUrl(), config.relaySecret(), clock, profile);
    }

    /** Runtime of realm {@code sq-karir}. */
    public static KarirRuntime get() {
        return forProfile(IdentityProfile.KARIR);
    }

    /** Runtime for the realm being served. A realm this provider does not know gets a runtime that fails closed. */
    public static KarirRuntime forRealm(RealmModel realm) {
        IdentityProfile profile = realm == null ? null : IdentityProfile.forRealm(realm.getName());
        if (profile != null) {
            return forProfile(profile);
        }
        KarirRuntime current = unconfigured;
        if (current == null) {
            synchronized (KarirRuntime.class) {
                current = unconfigured;
                if (current == null) {
                    LOG.errorf("External identity provider used in realm %s, which has no profile; every step fails closed",
                            realm == null ? "?" : realm.getName());
                    current = new KarirRuntime(IdentityProfile.KARIR, KarirConfig.unconfigured(), Clock.systemUTC());
                    unconfigured = current;
                }
            }
        }
        return current;
    }

    public static KarirRuntime forProfile(IdentityProfile profile) {
        synchronized (INSTANCES) {
            return INSTANCES.computeIfAbsent(profile, key -> {
                KarirConfig config = KarirConfig.fromEnvironment(System.getenv(), key);
                LOG.infof("External identity provider configured for %s: %s", key.realmName(), config);
                return new KarirRuntime(key, config, Clock.systemUTC());
            });
        }
    }

    public IdentityProfile profile() {
        return profile;
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
