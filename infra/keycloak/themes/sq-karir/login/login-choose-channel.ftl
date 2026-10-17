<#import "template.ftl" as layout>
<#import "buttons.ftl" as buttons>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('channel'); section>
<!-- template: sq-karir login-choose-channel.ftl -->
    <#if section = "header">
        ${msg("karirChooseChannelTitle")}
    <#elseif section = "form">
        <form id="kc-choose-channel-form" class="${properties.kcFormClass!}" action="${url.loginAction}" method="post" novalidate="novalidate">
            <fieldset class="sq-karir-channels" aria-describedby="channel-help">
                <legend class="sq-karir-help" id="channel-help">${msg("karirChooseChannelHelp")}</legend>
                <#list karirChannels as option>
                    <label class="sq-karir-channel" for="channel-${option.id}">
                        <input id="channel-${option.id}" type="radio" name="channel" value="${option.id}" <#if option?is_first>checked</#if>/>
                        <span class="sq-karir-channel__name">${msg("karirChannel_" + option.id)}</span>
                        <span class="sq-karir-channel__destination">${option.destination}</span>
                    </label>
                </#list>
            </fieldset>
            <#if messagesPerField.existsError('channel')>
                <p class="sq-karir-error" role="alert">${messagesPerField.get('channel')}</p>
            </#if>
            <@buttons.actionGroup>
                <@buttons.button id="kc-send-code" label="karirDoSendCode"/>
                <@buttons.buttonLink href=url.loginUrl label="backToLogin"/>
            </@buttons.actionGroup>
        </form>
    </#if>
</@layout.registrationLayout>
