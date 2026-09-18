#!/usr/bin/env python3
"""Browser contract for the real Keycloak 26.7.2 keycloak.v3 Account Console.

The script intentionally uses only Python's standard library and the ChromeDriver
already present on GitHub-hosted Ubuntu runners. It never serializes cookies,
tokens, or credentials.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen


ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"


class WebDriverError(RuntimeError):
    pass


class Driver:
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.session_id: str | None = None

    def request(self, method: str, path: str, payload: Any | None = None) -> Any:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            self.endpoint + path,
            data=data,
            headers={"Content-Type": "application/json"},
            method=method,
        )
        try:
            with urlopen(request, timeout=30) as response:
                body = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                body = json.loads(error.read().decode("utf-8"))
                message = body.get("value", {}).get("message", error.reason)
            except Exception:
                message = error.reason
            raise WebDriverError(f"{method} {path} failed: {message}") from None

        value = body.get("value")
        if isinstance(value, dict) and value.get("error"):
            raise WebDriverError(
                f"{method} {path} failed: {value.get('message', value['error'])}"
            )
        return value

    def start(self) -> None:
        value = self.request(
            "POST",
            "/session",
            {
                "capabilities": {
                    "alwaysMatch": {
                        "browserName": "chrome",
                        "goog:chromeOptions": {
                            "args": [
                                "--headless=new",
                                "--no-sandbox",
                                "--disable-gpu",
                                "--disable-dev-shm-usage",
                                "--no-first-run",
                                "--no-default-browser-check",
                                "--window-size=1440,900",
                            ]
                        },
                    }
                }
            },
        )
        self.session_id = value["sessionId"]

    def close(self) -> None:
        if self.session_id:
            try:
                self.request("DELETE", f"/session/{self.session_id}")
            finally:
                self.session_id = None

    def path(self, suffix: str) -> str:
        if not self.session_id:
            raise WebDriverError("WebDriver session is not running")
        return f"/session/{self.session_id}{suffix}"

    def execute(self, script: str, args: list[Any] | None = None) -> Any:
        return self.request(
            "POST",
            self.path("/execute/sync"),
            {"script": script, "args": args or []},
        )

    def goto(self, url: str) -> None:
        self.request("POST", self.path("/url"), {"url": url})

    def set_viewport(self, width: int, height: int) -> None:
        self.request(
            "POST",
            self.path("/goog/cdp/execute"),
            {
                "cmd": "Emulation.setDeviceMetricsOverride",
                "params": {
                    "width": width,
                    "height": height,
                    "deviceScaleFactor": 1,
                    "mobile": False,
                },
            },
        )

    def screenshot(self, output: Path) -> None:
        encoded = self.request("GET", self.path("/screenshot"))
        output.write_bytes(base64.b64decode(encoded))

    def wait(self, script: str, label: str, timeout: float = 30.0) -> Any:
        deadline = time.monotonic() + timeout
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            try:
                value = self.execute(script)
                if value:
                    return value
            except Exception as error:
                last_error = error
            time.sleep(0.2)
        suffix = f" ({last_error})" if last_error else ""
        raise WebDriverError(f"Timed out waiting for {label}{suffix}")

    def fill(self, selector: str, value: str) -> None:
        changed = self.execute(
            """
            const [selector, value] = arguments;
            const input = document.querySelector(selector);
            if (!input) return false;
            input.focus();
            const prototype = input instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
            setter.call(input, value);
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
            """,
            [selector, value],
        )
        if not changed:
            raise WebDriverError(f"Missing input: {selector}")

    def click(self, selector: str) -> None:
        clicked = self.execute(
            """
            const button = document.querySelector(arguments[0]);
            if (!button) return false;
            button.click();
            return true;
            """,
            [selector],
        )
        if not clicked:
            raise WebDriverError(f"Missing clickable element: {selector}")


MEASURE_SCRIPT = r"""
return (() => {
  const visible = (element) => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" &&
      Number(style.opacity || 1) > 0 && box.width > 0 && box.height > 0;
  };
  const rect = (element) => {
    const box = element.getBoundingClientRect();
    return {
      top: box.top,
      right: box.right,
      bottom: box.bottom,
      left: box.left,
      width: box.width,
      height: box.height,
    };
  };
  const dark = (color) => {
    const values = color.match(/[0-9.]+/g)?.map(Number) || [];
    if (values.length < 3) return false;
    const [red, green, blue] = values;
    const alpha = values.length > 3 ? values[3] : 1;
    if (alpha < .2) return false;
    return (red + green + blue) / 3 < 80;
  };

  const masthead = document.querySelector(".pf-v5-c-masthead");
  const mastheadContent = document.querySelector(".pf-v5-c-masthead__content");
  const toolbar = mastheadContent?.querySelector(".pf-v5-c-toolbar");
  const toolbarContent = mastheadContent?.querySelector(".pf-v5-c-toolbar__content");
  const brand = document.querySelector(".pf-v5-c-masthead__brand");
  const logo = brand?.querySelector("img");
  const title = document.querySelector('h1[data-testid="page-heading"]');
  const toggle = document.querySelector(".pf-v5-c-masthead__toggle button");

  if (!masthead || !mastheadContent || !toolbar || !brand || !logo || !title || !toggle) {
    return { ready: false };
  }

  const mastheadBox = rect(masthead);
  const contentBox = rect(mastheadContent);
  const titleBox = rect(title);
  const pseudo = getComputedStyle(brand, "::after").content.replace(/^["']|["']$/g, "");
  const stylesheetUrls = [...document.styleSheets]
    .map((sheet) => sheet.href || "")
    .filter(Boolean);
  const surfaces = [masthead, mastheadContent, toolbar, toolbarContent].filter(Boolean);
  const clippedControls = [...document.querySelectorAll(
    ".pf-v5-c-page__main button, .pf-v5-c-page__main input, .pf-v5-c-page__main select, " +
    ".pf-v5-c-masthead button, .pf-v5-c-masthead a"
  )]
    .filter(visible)
    .map((element) => ({ element, box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.left < -1 || box.right > window.innerWidth + 1)
    .map(({ element }) => element.getAttribute("data-testid") || element.id || element.tagName);

  return {
    ready: true,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    masthead: mastheadBox,
    mastheadContent: contentBox,
    title: titleBox,
    titleText: title.textContent.trim(),
    titleGap: titleBox.top - mastheadBox.bottom,
    mastheadContentContained:
      contentBox.top >= mastheadBox.top - 1 &&
      contentBox.bottom <= mastheadBox.bottom + 1,
    titleAfterMasthead: titleBox.top >= mastheadBox.bottom + 12,
    toolbarBackground: getComputedStyle(toolbar).backgroundColor,
    toolbarDark: surfaces.some((element) => dark(getComputedStyle(element).backgroundColor)),
    logoLoaded: logo.complete && logo.naturalWidth > 0 && logo.naturalHeight > 0,
    brandText: pseudo,
    brandTextVisible: pseudo === "Akun SQ" && visible(brand),
    horizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    toggleExists: Boolean(toggle),
    toggleVisible: visible(toggle),
    clippedControls,
    stylesheetUrls,
    sidebarLinks: [...document.querySelectorAll(".pf-v5-c-page__sidebar a[href]")]
      .map((link) => link.getAttribute("href")),
  };
})();
"""


def clean_url(url: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def page_ready_script(title: str) -> str:
    return f"""
    const heading = document.querySelector('h1[data-testid="page-heading"]');
    return heading && heading.textContent.includes({json.dumps(title)});
    """


def assert_layout(
    metrics: dict[str, Any],
    *,
    width: int,
    expected_stylesheet: str,
    label: str,
) -> None:
    if not metrics.get("ready"):
        raise WebDriverError(f"{label}: native Account Console structure was not ready")
    if metrics["viewport"]["width"] != width:
        raise WebDriverError(
            f"{label}: expected viewport width {width}, got {metrics['viewport']['width']}"
        )
    if not metrics["mastheadContentContained"]:
        raise WebDriverError(
            f"{label}: masthead content escapes masthead: "
            f"{metrics['mastheadContent']} vs {metrics['masthead']}"
        )
    if not metrics["titleAfterMasthead"]:
        raise WebDriverError(
            f"{label}: page title overlaps masthead (gap={metrics['titleGap']:.2f}px)"
        )
    if metrics["toolbarDark"]:
        raise WebDriverError(
            f"{label}: dark masthead/toolbar surface remains "
            f"({metrics['toolbarBackground']})"
        )
    if not metrics["logoLoaded"]:
        raise WebDriverError(f"{label}: organization mark did not load")
    if not metrics["brandTextVisible"] or metrics["brandText"] != "Akun SQ":
        raise WebDriverError(
            f"{label}: visible Akun SQ masthead brand is missing "
            f"(brand={metrics['brandText']!r})"
        )
    if metrics["horizontalOverflow"]:
        raise WebDriverError(f"{label}: document exceeds viewport width")
    if width <= 768 and not metrics["toggleVisible"]:
        raise WebDriverError(f"{label}: mobile navigation toggle is not visible")
    if metrics["clippedControls"]:
        raise WebDriverError(
            f"{label}: visible controls are clipped: {metrics['clippedControls']}"
        )
    if not any(expected_stylesheet in url for url in metrics["stylesheetUrls"]):
        raise WebDriverError(
            f"{label}: child stylesheet {expected_stylesheet} was not loaded"
        )


def sidebar_state(driver: Driver) -> dict[str, Any]:
    return driver.execute(
        """
        const sidebar = document.querySelector(".pf-v5-c-page__sidebar");
        const toggle = document.querySelector(".pf-v5-c-masthead__toggle button");
        if (!sidebar || !toggle) return {};
        const box = sidebar.getBoundingClientRect();
        const style = getComputedStyle(sidebar);
        const visibleLinks = [...sidebar.querySelectorAll("a[href]")].filter((link) => {
          const rect = link.getBoundingClientRect();
          const linkStyle = getComputedStyle(link);
          return linkStyle.visibility !== "hidden" && linkStyle.display !== "none" &&
            rect.width > 0 && rect.height > 0;
        });
        return {
          className: sidebar.className,
          display: style.display,
          visibility: style.visibility,
          transform: style.transform,
          x: Math.round(box.x),
          width: Math.round(box.width),
          expanded: toggle.getAttribute("aria-expanded"),
          visibleLinks: visibleLinks.length,
          linksContained: visibleLinks.every((link) => {
            const rect = link.getBoundingClientRect();
            return rect.left >= -1 && rect.right <= window.innerWidth + 1;
          }),
        };
        """
    )


def exercise_mobile_drawer(driver: Driver) -> None:
    before = sidebar_state(driver)
    if not before:
        raise WebDriverError("mobile drawer/sidebar is missing")
    driver.click(".pf-v5-c-masthead__toggle button")
    deadline = time.monotonic() + 5
    after = before
    while time.monotonic() < deadline:
        after = sidebar_state(driver)
        if (
            after
            and after != before
            and after["x"] >= -1
            and after["width"] >= 240
            and after["visibleLinks"] >= 3
            and after["linksContained"]
        ):
            time.sleep(0.2)
            return
        time.sleep(0.1)
    raise WebDriverError(f"mobile navigation drawer did not fully open: {after}")


def exercise_account_menu(driver: Driver, selector: str, label: str) -> None:
    state = driver.execute(
        """
        const button = document.querySelector(arguments[0]);
        if (!button) return null;
        const style = getComputedStyle(button);
        const box = button.getBoundingClientRect();
        return {
          expanded: button.getAttribute("aria-expanded"),
          text: button.textContent.trim(),
          visible: style.display !== "none" && style.visibility !== "hidden" &&
            box.width > 0 && box.height > 0,
          color: style.color,
        };
        """,
        [selector],
    )
    if not state or not state["visible"]:
        raise WebDriverError(f"{label}: account menu toggle is not visible")
    if selector == '[data-testid="options-toggle"]' and not state["text"]:
        raise WebDriverError(f"{label}: account menu username is not visible")

    driver.click(selector)
    driver.wait(
        """
        return [...document.querySelectorAll(".pf-v5-c-menu")].some((menu) => {
          const style = getComputedStyle(menu);
          const box = menu.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            box.width > 0 && box.height > 0;
        });
        """,
        f"{label} account menu open",
        timeout=5,
    )
    driver.click(selector)
    driver.wait(
        """
        return ![...document.querySelectorAll(".pf-v5-c-menu")].some((menu) => {
          const style = getComputedStyle(menu);
          const box = menu.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" &&
            box.width > 0 && box.height > 0;
        });
        """,
        f"{label} account menu close",
        timeout=5,
    )


def login(driver: Driver, base_url: str, username: str, password: str) -> None:
    driver.goto(base_url)
    driver.wait(
        """
        return Boolean(
          document.querySelector(".pf-v5-c-masthead") ||
          document.querySelector("#username")
        );
        """,
        "Account Console or Akun SQ login",
    )

    if driver.execute('return Boolean(document.querySelector("#username"));'):
        driver.fill("#username", username)
        if driver.execute('return Boolean(document.querySelector("#password"));'):
            driver.fill("#password", password)
        driver.click("#kc-login")
        time.sleep(0.5)

        if (
            not driver.execute(
                'return Boolean(document.querySelector(".pf-v5-c-masthead"));'
            )
            and driver.execute('return Boolean(document.querySelector("#password"));')
        ):
            driver.fill("#password", password)
            driver.click("#kc-login")

    driver.wait(
        'return Boolean(document.querySelector(".pf-v5-c-masthead"));',
        "authenticated keycloak.v3 Account Console",
        timeout=40,
    )


def validate_native_navigation(driver: Driver, base_url: str) -> None:
    hrefs = driver.execute(
        """
        return [...document.querySelectorAll(".pf-v5-c-page__sidebar a[href]")]
          .map((link) => link.getAttribute("href"));
        """
    )
    required = [
        "account-security/signing-in",
        "account-security/device-activity",
        "applications",
    ]
    for fragment in required:
        if not any(fragment in href for href in hrefs):
            raise WebDriverError(f"native navigation is missing {fragment}")

    checks = [
        ("account-security/device-activity", "Sesi", ".signed-in-device-list"),
        ("applications", "Aplikasi", 'h1[data-testid="page-heading"]'),
    ]
    for path, title, selector in checks:
        driver.goto(urljoin(base_url, path))
        driver.wait(page_ready_script(title), title)
        driver.wait(
            f'return Boolean(document.querySelector({json.dumps(selector)}));',
            f"{title} usable surface",
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--webdriver", default="http://127.0.0.1:9515")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--stylesheet", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    username = os.environ["AKUN_SQ_UAT_USERNAME"]
    password = os.environ["AKUN_SQ_UAT_PASSWORD"]
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    base_url = args.base_url if args.base_url.endswith("/") else args.base_url + "/"
    security_url = urljoin(base_url, "account-security/signing-in")
    viewports = [(320, 844), (360, 844), (390, 844), (412, 844), (1440, 900)]
    report: dict[str, Any] = {
        "baseUrl": clean_url(base_url),
        "stylesheet": args.stylesheet,
        "viewports": {},
    }

    driver = Driver(args.webdriver)
    try:
        driver.start()
        login(driver, base_url, username, password)

        for width, height in viewports:
            key = f"{width}x{height}"
            report["viewports"][key] = {}

            driver.set_viewport(width, height)
            driver.goto(base_url)
            driver.wait(page_ready_script("Informasi pribadi"), f"personal information {key}")
            personal = driver.execute(MEASURE_SCRIPT)
            assert_layout(
                personal,
                width=width,
                expected_stylesheet=args.stylesheet,
                label=f"personal information {key}",
            )
            report["viewports"][key]["personal"] = personal
            driver.screenshot(output_dir / f"account-personal-{key}.png")

            driver.goto(security_url)
            driver.wait(page_ready_script("Keamanan"), f"account security {key}")
            driver.wait(
                'return Boolean(document.querySelector(".pf-v5-c-data-list"));',
                f"security credential list {key}",
            )
            security = driver.execute(MEASURE_SCRIPT)
            assert_layout(
                security,
                width=width,
                expected_stylesheet=args.stylesheet,
                label=f"account security {key}",
            )
            report["viewports"][key]["security"] = security
            driver.screenshot(output_dir / f"account-security-{key}.png")

            if width == 390:
                exercise_account_menu(
                    driver, '[data-testid="options-kebab-toggle"]', "mobile"
                )
                exercise_mobile_drawer(driver)
                driver.screenshot(
                    output_dir / "account-security-navigation-mobile-390x844.png"
                )

        driver.set_viewport(1440, 900)
        driver.goto(base_url)
        driver.wait(page_ready_script("Informasi pribadi"), "desktop personal information")
        exercise_account_menu(driver, '[data-testid="options-toggle"]', "desktop")
        validate_native_navigation(driver, base_url)

        driver.set_viewport(390, 844)
        driver.goto(urljoin(base_url, "account-security/device-activity"))
        driver.wait(page_ready_script("Sesi"), "mobile device/session list")
        session_metrics = driver.execute(MEASURE_SCRIPT)
        assert_layout(
            session_metrics,
            width=390,
            expected_stylesheet=args.stylesheet,
            label="device/session list 390x844",
        )
        report["session390x844"] = session_metrics

        output_dir.joinpath("account-runtime-metrics.json").write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    finally:
        driver.close()

    print("ACCOUNT_CONSOLE_RUNTIME_PASS")
    for key, pages in report["viewports"].items():
        personal = pages["personal"]
        security = pages["security"]
        print(
            f"{key}: personal_gap={personal['titleGap']:.1f}px "
            f"security_gap={security['titleGap']:.1f}px "
            f"toolbar={security['toolbarBackground']} overflow=false"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
