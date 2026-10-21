<#macro content>
  <div class="sq-account-brand" aria-label="Islamic Tahfizh School Sabilul Qur&apos;an">
    <picture>
      <source srcset="${url.resourcesPath}/img/logo-white.png" media="(prefers-color-scheme: dark)">
      <img class="sq-account-brand__logo" src="${url.resourcesPath}/img/logo.png" alt="" aria-hidden="true" width="2240" height="721">
    </picture>
  </div>
  <#if (pageId!"") == "login">
    <#-- A short description stands in for the hidden page title (owner, 2026-10-21). -->
    <p class="sq-account-lede">${msg("akunSqLoginLede")}</p>
  </#if>
  <p class="sq-login-footer">${msg("akunSqFooter")}</p>
  <#if (pageId!"") == "info">
    <#-- Native info.ftl repeats the message as title and body when there is no separate header. -->
    <script>
      (function () {
        var title = document.getElementById("kc-page-title");
        var body = document.querySelector("#kc-info-message > .instruction");
        if (title && body && title.textContent.trim() === body.textContent.trim()) body.hidden = true;
      })();
    </script>
  </#if>
  <#if (pageId!"") == "logout-confirm">
    <#-- Keycloak 26.7.2 answers a stale sign-out confirmation first with "failedLogout" and,
         when the same form is sent again, with an internal server error (NPE in
         LogoutEndpoint.logoutConfirmAction). The confirmation code lives only a few minutes,
         so a page reached with Back/Forward (from the HTTP cache or the back/forward cache)
         or left open too long is reloaded to get a fresh code before it can be submitted.
         Reloading the GET logout URL is safe: it only renders a new confirmation page. -->
    <script>
      (function () {
        var navigation = window.performance && performance.getEntriesByType
          ? performance.getEntriesByType("navigation")[0]
          : null;
        if (navigation && navigation.type === "back_forward") {
          window.location.reload();
          return;
        }
        var openedAt = Date.now();
        var maxAgeMs = 4 * 60 * 1000;
        window.addEventListener("pageshow", function (event) {
          if (event.persisted) window.location.reload();
        });
        document.addEventListener("submit", function (event) {
          if (Date.now() - openedAt > maxAgeMs) {
            event.preventDefault();
            window.location.reload();
          }
        }, true);
      })();
    </script>
  </#if>
</#macro>
