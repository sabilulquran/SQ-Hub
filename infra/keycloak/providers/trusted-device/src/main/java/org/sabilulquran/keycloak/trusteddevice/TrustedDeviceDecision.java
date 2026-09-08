package org.sabilulquran.keycloak.trusteddevice;

final class TrustedDeviceDecision {
    private TrustedDeviceDecision() {
    }

    static boolean shouldIssue(boolean requested, boolean otpValid) {
        return requested && otpValid;
    }
}
