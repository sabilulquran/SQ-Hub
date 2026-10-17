package org.sabilulquran.keycloak.karir;

import jakarta.ws.rs.core.MultivaluedMap;
import java.util.List;
import org.keycloak.authentication.RequiredActionContext;
import org.keycloak.authentication.RequiredActionProvider;
import org.keycloak.events.Details;
import org.keycloak.events.EventType;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;

/**
 * After registration the candidate proves the WhatsApp number with a 6-digit code (REC-IMPL-001 §4.3). Until then
 * the sign-in to Karir SQ does not complete. A Karir SQ contact change resets {@code wa_verified}, so a self-registered
 * candidate verifies the new number on the next sign-in.
 */
final class VerifyWhatsAppRequiredAction implements RequiredActionProvider {
    static final String PURPOSE = "verify";

    @Override
    public void evaluateTriggers(RequiredActionContext context) {
        UserModel user = context.getUser();
        IdentityProfile profile = KarirRuntime.forRealm(context.getRealm()).profile();
        if (IdentityProfile.SOURCE_SELF.equals(user.getFirstAttribute(profile.sourceAttribute()))
                && profile.numberToVerify(user) != null) {
            user.addRequiredAction(VerifyWhatsAppRequiredActionFactory.PROVIDER_ID);
        }
    }

    @Override
    public void requiredActionChallenge(RequiredActionContext context) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        String wa = numberToVerify(runtime.profile(), context.getUser());
        if (wa == null) {
            // Nothing to verify; Karir SQ removed the number during an account recovery.
            context.success();
            return;
        }
        OtpState otp = CodeForms.state(context.getAuthenticationSession(), runtime);
        String message = otp.hasCode() ? null : send(context, runtime, otp, wa);
        context.challenge(render(context, otp, wa, message, message == null || KarirForms.CODE_SENT.equals(message)));
    }

    @Override
    public void processAction(RequiredActionContext context) {
        KarirRuntime runtime = KarirRuntime.forRealm(context.getRealm());
        String wa = numberToVerify(runtime.profile(), context.getUser());
        if (wa == null) {
            context.success();
            return;
        }
        OtpState otp = CodeForms.state(context.getAuthenticationSession(), runtime);
        MultivaluedMap<String, String> input = context.getHttpRequest().getDecodedFormParameters();

        if (input.containsKey(CodeForms.ACTION_RESEND)) {
            long wait = otp.secondsUntilResend();
            if (wait > 0) {
                LoginFormsProvider form = context.form();
                form.addError(new FormMessage(CodeForms.FIELD_CODE, KarirForms.CODE_RESEND_WAIT, wait));
                context.challenge(CodeForms.codePage(form, PURPOSE, Contact.maskWaNumber(wa), otp, false)
                        .createForm(CodeForms.TEMPLATE));
                return;
            }
            String message = send(context, runtime, otp, wa);
            context.challenge(render(context, otp, wa, message, KarirForms.CODE_SENT.equals(message)));
            return;
        }

        OtpState.Check check = otp.verify(input.getFirst(CodeForms.FIELD_CODE));
        if (check == OtpState.Check.VALID) {
            runtime.profile().markVerified(context.getUser(), wa);
            org.keycloak.events.EventBuilder verified = context.getEvent().clone()
                    .event(EventType.CUSTOM_REQUIRED_ACTION)
                    .detail(Details.CUSTOM_REQUIRED_ACTION, VerifyWhatsAppRequiredActionFactory.PROVIDER_ID)
                    .detail(KarirEvents.DETAIL_CHANNEL, "whatsapp");
            ResetByCodeAuthenticator.addWaHash(verified, runtime, wa);
            verified.success();
            context.success();
            return;
        }
        context.getEvent().clone()
                .event(EventType.CUSTOM_REQUIRED_ACTION_ERROR)
                .detail(Details.CUSTOM_REQUIRED_ACTION, VerifyWhatsAppRequiredActionFactory.PROVIDER_ID)
                .detail(KarirEvents.DETAIL_CHANNEL, "whatsapp")
                .error(check == OtpState.Check.WRONG || check == OtpState.Check.TOO_MANY_ATTEMPTS
                        ? KarirEvents.CODE_INVALID : KarirEvents.CODE_EXPIRED);
        context.challenge(render(context, otp, wa, CodeForms.messageFor(check), false));
    }

    /** Sends a new code and returns the message key to show. */
    private static String send(RequiredActionContext context, KarirRuntime runtime, OtpState otp, String wa) {
        UserModel user = context.getUser();
        String identifierAttribute = runtime.profile().identifierAttribute();
        String accountKey = user.getFirstAttribute(identifierAttribute) != null
                ? user.getFirstAttribute(identifierAttribute) : user.getId();
        if (!runtime.abuseGuard().tryCodeRequest(accountKey)) {
            sendEvent(context).error(KarirEvents.CODE_LIMIT);
            return KarirForms.CODE_LIMIT;
        }
        String code = otp.issue("whatsapp");
        OtpDeliveryClient.Result result = runtime.delivery().sendWhatsApp(wa, code, OtpDeliveryClient.Purpose.VERIFY);
        if (result != OtpDeliveryClient.Result.SENT) {
            otp.clear();
            sendEvent(context).error(KarirEvents.CODE_NOT_SENT);
            return KarirForms.CODE_NOT_SENT_TRY_LATER;
        }
        sendEvent(context).success();
        return KarirForms.CODE_SENT;
    }

    /**
     * Karir: its one number, as before. Keluarga: the first number that has not passed a code yet, so a number added
     * by Keluarga SQ is verified on the next sign-in.
     */
    private static String numberToVerify(IdentityProfile profile, UserModel user) {
        if (profile.multipleNumbers()) {
            return profile.numberToVerify(user);
        }
        List<String> numbers = profile.waNumbers(user);
        return numbers.isEmpty() ? null : numbers.get(0);
    }

    private static org.keycloak.events.EventBuilder sendEvent(RequiredActionContext context) {
        return context.getEvent().clone()
                .event(EventType.CUSTOM_REQUIRED_ACTION)
                .user(context.getUser())
                .detail(Details.CUSTOM_REQUIRED_ACTION, VerifyWhatsAppRequiredActionFactory.PROVIDER_ID)
                .detail(KarirEvents.DETAIL_PURPOSE, "send_code")
                .detail(KarirEvents.DETAIL_CHANNEL, "whatsapp");
    }

    private static jakarta.ws.rs.core.Response render(RequiredActionContext context, OtpState otp, String wa,
                                                      String message, boolean success) {
        LoginFormsProvider form = context.form();
        if (message != null) {
            if (success) {
                form.setSuccess(message, Contact.maskWaNumber(wa));
            } else {
                form.addError(new FormMessage(CodeForms.FIELD_CODE, message));
            }
        }
        return CodeForms.codePage(form, PURPOSE, Contact.maskWaNumber(wa), otp, false).createForm(CodeForms.TEMPLATE);
    }

    @Override
    public void close() {
    }
}
