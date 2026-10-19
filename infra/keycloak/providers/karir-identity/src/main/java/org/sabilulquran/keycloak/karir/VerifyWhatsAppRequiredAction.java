package org.sabilulquran.keycloak.karir;

import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.Response;
import java.util.List;
import org.keycloak.authentication.RequiredActionContext;
import org.keycloak.authentication.RequiredActionProvider;
import org.keycloak.events.Details;
import org.keycloak.events.EventBuilder;
import org.keycloak.events.EventType;
import org.keycloak.forms.login.LoginFormsProvider;
import org.keycloak.models.UserModel;
import org.keycloak.models.utils.FormMessage;

/**
 * After registration the candidate proves the WhatsApp number with a 6-digit code (REC-IMPL-001 §4.3). Until then
 * the sign-in to Karir SQ does not complete. A Karir SQ contact change resets {@code wa_verified}, so a self-registered
 * candidate verifies the new number on the next sign-in.
 *
 * <p>Keluarga SQ adds two things the family needs to get unstuck on their own (KEL-IMPL-001 §4.5): "Ganti nomor",
 * which corrects a number typed wrongly at sign-up, and an honest notice when the relay ran in dry run, so the page
 * never claims a code was sent while the app runs with the {@code log} WhatsApp adapter.
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
        context.challenge(render(context, runtime, otp, wa, message));
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

        if (input.containsKey(CodeForms.ACTION_CHANGE_NUMBER) && runtime.profile().allowsNumberChangeAtVerify()) {
            changeNumber(context, runtime, otp, wa, input.getFirst(CodeForms.FIELD_WA));
            return;
        }

        if (input.containsKey(CodeForms.ACTION_RESEND)) {
            long wait = otp.secondsUntilResend();
            if (wait > 0) {
                context.challenge(render(context, runtime, otp, wa, null,
                        new FormMessage(CodeForms.FIELD_CODE, KarirForms.CODE_RESEND_WAIT, wait)));
                return;
            }
            context.challenge(render(context, runtime, otp, wa, send(context, runtime, otp, wa)));
            return;
        }

        OtpState.Check check = otp.verify(input.getFirst(CodeForms.FIELD_CODE));
        if (check == OtpState.Check.VALID) {
            runtime.profile().markVerified(context.getUser(), wa);
            EventBuilder verified = context.getEvent().clone()
                    .event(EventType.CUSTOM_REQUIRED_ACTION)
                    .detail(Details.CUSTOM_REQUIRED_ACTION, VerifyWhatsAppRequiredActionFactory.PROVIDER_ID)
                    .detail(KarirEvents.DETAIL_CHANNEL, "whatsapp");
            ResetByCodeAuthenticator.addWaHash(verified, runtime, wa);
            verified.success();
            CodeForms.setDryRun(context.getAuthenticationSession(), false);
            context.success();
            return;
        }
        context.getEvent().clone()
                .event(EventType.CUSTOM_REQUIRED_ACTION_ERROR)
                .detail(Details.CUSTOM_REQUIRED_ACTION, VerifyWhatsAppRequiredActionFactory.PROVIDER_ID)
                .detail(KarirEvents.DETAIL_CHANNEL, "whatsapp")
                .error(check == OtpState.Check.WRONG || check == OtpState.Check.TOO_MANY_ATTEMPTS
                        ? KarirEvents.CODE_INVALID : KarirEvents.CODE_EXPIRED);
        context.challenge(render(context, runtime, otp, wa, null,
                new FormMessage(CodeForms.FIELD_CODE, CodeForms.messageFor(check))));
    }

    /**
     * Replaces the number being verified with the one the family typed, then sends a code there. The resend wait is
     * not applied, because this is a correction rather than a repeat; {@link AbuseGuard} still caps codes per account.
     */
    private static void changeNumber(RequiredActionContext context, KarirRuntime runtime, OtpState otp, String wa,
                                     String typed) {
        String normalized = Contact.normalizeWaNumber(typed);
        if (normalized == null) {
            numberEvent(context, runtime, null).error(KarirEvents.WA_INVALID);
            context.challenge(render(context, runtime, otp, wa, null,
                    new FormMessage(CodeForms.FIELD_WA, KarirForms.INVALID_WA)));
            return;
        }
        if (normalized.equals(wa)) {
            context.challenge(render(context, runtime, otp, wa, null,
                    new FormMessage(CodeForms.FIELD_WA, KarirForms.WA_SAME)));
            return;
        }
        runtime.profile().replaceNumber(context.getUser(), wa, normalized);
        otp.clear();
        numberEvent(context, runtime, normalized).success();
        String next = numberToVerify(runtime.profile(), context.getUser());
        if (next == null) {
            // The family moved to a number they had already verified; there is nothing left to prove.
            CodeForms.setDryRun(context.getAuthenticationSession(), false);
            context.success();
            return;
        }
        context.challenge(render(context, runtime, otp, next, send(context, runtime, otp, next)));
    }

    /** Sends a new code and returns the message key to show, or {@code null} when the dry-run notice says it all. */
    private static String send(RequiredActionContext context, KarirRuntime runtime, OtpState otp, String wa) {
        UserModel user = context.getUser();
        String identifierAttribute = runtime.profile().identifierAttribute();
        String accountKey = user.getFirstAttribute(identifierAttribute) != null
                ? user.getFirstAttribute(identifierAttribute) : user.getId();
        if (!runtime.abuseGuard().tryCodeRequest(accountKey)) {
            CodeForms.setDryRun(context.getAuthenticationSession(), false);
            sendEvent(context).error(KarirEvents.CODE_LIMIT);
            return KarirForms.CODE_LIMIT;
        }
        String code = otp.issue("whatsapp");
        OtpDeliveryClient.Result result = runtime.delivery().sendWhatsApp(wa, code, OtpDeliveryClient.Purpose.VERIFY);
        if (!result.accepted()) {
            otp.clear();
            CodeForms.setDryRun(context.getAuthenticationSession(), false);
            sendEvent(context).error(KarirEvents.CODE_NOT_SENT);
            return KarirForms.CODE_NOT_SENT_TRY_LATER;
        }
        boolean dryRun = result == OtpDeliveryClient.Result.SENT_DRY_RUN;
        CodeForms.setDryRun(context.getAuthenticationSession(), dryRun);
        EventBuilder sent = sendEvent(context);
        if (dryRun) {
            sent.detail(KarirEvents.DETAIL_DRY_RUN, "true");
        }
        sent.success();
        return dryRun ? null : KarirForms.CODE_SENT;
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

    private static EventBuilder sendEvent(RequiredActionContext context) {
        return context.getEvent().clone()
                .event(EventType.CUSTOM_REQUIRED_ACTION)
                .user(context.getUser())
                .detail(Details.CUSTOM_REQUIRED_ACTION, VerifyWhatsAppRequiredActionFactory.PROVIDER_ID)
                .detail(KarirEvents.DETAIL_PURPOSE, "send_code")
                .detail(KarirEvents.DETAIL_CHANNEL, "whatsapp");
    }

    /** Audit of "Ganti nomor": the acting account, and the HMAC of the new number, never the number itself. */
    private static EventBuilder numberEvent(RequiredActionContext context, KarirRuntime runtime, String waDigits) {
        EventBuilder event = context.getEvent().clone()
                .event(EventType.CUSTOM_REQUIRED_ACTION)
                .user(context.getUser())
                .detail(Details.CUSTOM_REQUIRED_ACTION, VerifyWhatsAppRequiredActionFactory.PROVIDER_ID)
                .detail(KarirEvents.DETAIL_PURPOSE, "change_number")
                .detail(KarirEvents.DETAIL_CHANNEL, "whatsapp");
        ResetByCodeAuthenticator.addWaHash(event, runtime, waDigits);
        return event;
    }

    private static Response render(RequiredActionContext context, KarirRuntime runtime, OtpState otp, String wa,
                                   String sentMessage, FormMessage... extraErrors) {
        LoginFormsProvider form = context.form();
        boolean dryRun = CodeForms.dryRun(context.getAuthenticationSession());
        if (KarirForms.CODE_SENT.equals(sentMessage)) {
            form.setSuccess(sentMessage, Contact.maskWaNumber(wa));
        } else if (sentMessage != null) {
            form.addError(new FormMessage(CodeForms.FIELD_CODE, sentMessage));
        }
        for (FormMessage extra : extraErrors) {
            form.addError(extra);
        }
        CodeForms.dryRunNotice(form, dryRun);
        form.setAttribute("karirOtpCanChangeNumber", runtime.profile().allowsNumberChangeAtVerify());
        return CodeForms.codePage(form, PURPOSE, Contact.maskWaNumber(wa), otp, false).createForm(CodeForms.TEMPLATE);
    }

    @Override
    public void close() {
    }
}
