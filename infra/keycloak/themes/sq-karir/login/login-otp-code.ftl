<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('code'); section>
<!-- template: sq-karir login-otp-code.ftl -->
    <#if section = "header">
        <#if karirOtpPurpose == "verify">${msg("karirVerifyWaTitle")}<#else>${msg("karirCodeTitle")}</#if>
    <#elseif section = "form">
        <#if message?has_content && message.type == 'success'>
            <#-- The success alert already names where the code went. -->
        <#elseif karirOtpDestination??>
            <p class="sq-karir-help">${msg("karirCodeDestination", karirOtpDestination)}</p>
        <#else>
            <p class="sq-karir-help">${msg("karirCodeEnter")}</p>
        </#if>
        <form id="kc-otp-code-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post" novalidate="novalidate">
            <@field.input name="code" label=msg("karirCodeLabel") autocomplete="one-time-code" autofocus=true />
            <@buttons.actionGroup>
                <@buttons.button id="kc-verify-code" label="doVerify"/>
            </@buttons.actionGroup>
        </form>
        <form id="kc-otp-resend-form" class="${properties.kcFormClass!} sq-karir-secondary-actions" action="${url.loginAction}" method="post" novalidate="novalidate">
            <@buttons.actionGroup>
                <#if karirOtpResendWait gt 0>
                    <button id="kc-resend-code" name="resend" type="submit" class="${properties.kcButtonSecondaryClass} ${properties.kcButtonBlockClass}"
                            data-wait="${karirOtpResendWait?c}">${msg("karirDoResendIn", karirOtpResendWait?c)}</button>
                <#else>
                    <button id="kc-resend-code" name="resend" type="submit" class="${properties.kcButtonSecondaryClass} ${properties.kcButtonBlockClass}">${msg("karirDoResend")}</button>
                </#if>
                <#if karirOtpCanChangeChannel>
                    <button id="kc-change-channel" name="changeChannel" type="submit" class="${properties.kcButtonSecondaryClass} ${properties.kcButtonBlockClass}">${msg("karirDoChangeChannel")}</button>
                </#if>
            </@buttons.actionGroup>
        </form>
        <#if karirOtpResendWait gt 0>
        <script>
            <#outputformat "JavaScript">
            (function () {
                var button = document.getElementById("kc-resend-code");
                var left = parseInt(button.getAttribute("data-wait"), 10);
                var ready = ${msg("karirDoResend")?c};
                var template = ${msg("karirDoResendIn", "{0}")?c};
                var timer = setInterval(function () {
                    left -= 1;
                    if (left <= 0) {
                        clearInterval(timer);
                        button.textContent = ready;
                        return;
                    }
                    button.textContent = template.replace("{0}", String(left));
                }, 1000);
            })();
            </#outputformat>
        </script>
        </#if>
    </#if>
</@layout.registrationLayout>
