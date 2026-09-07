package org.sabilulquran.keycloak.trusteddevice;

import java.util.Collections;
import java.util.List;
import org.jboss.logging.Logger;
import org.keycloak.Config;
import org.keycloak.authentication.Authenticator;
import org.keycloak.authentication.AuthenticatorFactory;
import org.keycloak.models.AuthenticationExecutionModel;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.KeycloakSessionFactory;
import org.keycloak.models.credential.OTPCredentialModel;
import org.keycloak.provider.ProviderConfigProperty;

public final class TrustedDeviceOtpAuthenticatorFactory implements AuthenticatorFactory {
    public static final String PROVIDER_ID = "sq-trusted-device-otp";
    private static final Logger LOG = Logger.getLogger(TrustedDeviceOtpAuthenticatorFactory.class);
    private volatile TrustedDeviceManager manager;

    @Override
    public Authenticator create(KeycloakSession session) {
        if (manager == null) {
            initializeManager();
        }
        return new TrustedDeviceOtpAuthenticator(manager);
    }

    @Override
    public void init(Config.Scope config) {
        initializeManager();
    }

    private synchronized void initializeManager() {
        if (manager != null) {
            return;
        }
        String encodedKey = System.getenv("SQ_TRUSTED_DEVICE_SIGNING_KEY");
        try {
            manager = new TrustedDeviceManager(TrustedDeviceManager.decodeSigningKey(encodedKey));
        } catch (IllegalArgumentException failure) {
            manager = null;
            LOG.warn("Trusted-device signing key is unavailable; the provider will fail closed to TOTP");
        }
    }

    @Override
    public void postInit(KeycloakSessionFactory factory) {
    }

    @Override
    public void close() {
    }

    @Override
    public String getId() {
        return PROVIDER_ID;
    }

    @Override
    public String getReferenceCategory() {
        return OTPCredentialModel.TYPE;
    }

    @Override
    public boolean isConfigurable() {
        return false;
    }

    @Override
    public boolean isUserSetupAllowed() {
        return true;
    }

    @Override
    public AuthenticationExecutionModel.Requirement[] getRequirementChoices() {
        return REQUIREMENT_CHOICES;
    }

    @Override
    public String getDisplayType() {
        return "Akun SQ Trusted Device OTP";
    }

    @Override
    public String getHelpText() {
        return "Validates TOTP and optionally trusts this browser for at most 30 days.";
    }

    @Override
    public List<ProviderConfigProperty> getConfigProperties() {
        return Collections.emptyList();
    }
}
