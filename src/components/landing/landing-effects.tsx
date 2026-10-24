"use client";
// Behaviour for the landing page markup (ported from the design export's inline script):
// sticky-header shadow, mobile menu, scroll-spy nav, ACT FAST value tabs and scroll reveal.
import { useEffect } from "react";

export function LandingEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp");
    if (!root) return;
    root.classList.add("js");
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(t: Window | Document | HTMLElement, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      cleanups.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    const header = root.querySelector<HTMLElement>("#site-header");
    const toggle = root.querySelector<HTMLButtonElement>(".menu-toggle");
    const mobileNav = root.querySelector<HTMLElement>("#mobileNav");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Mobile menu
    const setMenu = (open: boolean, returnFocus = false) => {
      if (!toggle || !mobileNav) return;
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      mobileNav.hidden = !open;
      document.body.classList.toggle("menu-open", open);
      if (open) requestAnimationFrame(() => mobileNav.querySelector<HTMLAnchorElement>("a")?.focus());
      else if (returnFocus) toggle.focus();
    };
    if (toggle) on(toggle, "click", () => setMenu(toggle.getAttribute("aria-expanded") !== "true"));
    mobileNav?.querySelectorAll("a").forEach((a) => on(a, "click", () => setMenu(false, (a.getAttribute("href") ?? "").startsWith("#"))));
    on(document, "keydown", (e: KeyboardEvent) => {
      if (e.key === "Escape" && toggle?.getAttribute("aria-expanded") === "true") setMenu(false, true);
    });
    on(document, "click", (e: MouseEvent) => {
      if (!toggle || !mobileNav || toggle.getAttribute("aria-expanded") !== "true") return;
      if (!mobileNav.contains(e.target as Node) && !toggle.contains(e.target as Node)) setMenu(false, true);
    });
    on(window, "resize", () => {
      if (window.innerWidth >= 981 && toggle?.getAttribute("aria-expanded") === "true") setMenu(false);
    });
    cleanups.push(() => document.body.classList.remove("menu-open"));

    // Header shadow + scroll-spy
    const spyLinks = [...root.querySelectorAll<HTMLAnchorElement>(".primary-nav a[data-spy]")];
    const spySections = spyLinks.map((l) => document.getElementById(l.dataset.spy ?? "")).filter((x): x is HTMLElement => !!x);
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY + (header?.offsetHeight ?? 76) + 96;
        header?.classList.toggle("is-scrolled", window.scrollY > 8);
        let current = "";
        spySections.forEach((s) => {
          if (s.offsetTop <= y) current = s.id;
        });
        spyLinks.forEach((l) => {
          const active = l.dataset.spy === current;
          l.classList.toggle("is-active", active);
          if (active) l.setAttribute("aria-current", "location");
          else l.removeAttribute("aria-current");
        });
        ticking = false;
      });
    };
    on(window, "scroll", onScroll, { passive: true });
    onScroll();

    // ACT FAST value tabs
    const tabs = [...root.querySelectorAll<HTMLButtonElement>(".value-tab")];
    const panels = [...root.querySelectorAll<HTMLElement>(".value-panel")];
    const live = root.querySelector<HTMLElement>("#valueLive");
    let index = 0;
    const setValue = (i: number, o: { focus?: boolean; announce?: boolean; scroll?: boolean } = {}) => {
      if (!tabs.length) return;
      const next = (i + tabs.length) % tabs.length;
      index = next;
      tabs.forEach((t, k) => {
        t.setAttribute("aria-selected", String(k === next));
        t.tabIndex = k === next ? 0 : -1;
      });
      panels.forEach((p, k) => (p.hidden = k !== next));
      if (o.focus) tabs[next].focus();
      if (o.announce && live) live.textContent = `Value ${next + 1} of ${tabs.length}: ${tabs[next].querySelector(".word")?.textContent ?? ""}`;
      if (o.scroll) tabs[next].scrollIntoView({ block: "nearest", inline: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    };
    tabs.forEach((t, i) => {
      on(t, "click", () => setValue(i, { scroll: true }));
      on(t, "keydown", (e: KeyboardEvent) => {
        const target = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (target === undefined) return;
        e.preventDefault();
        setValue(target, { focus: true, scroll: true });
      });
    });
    const prev = root.querySelector<HTMLButtonElement>("#value-prev");
    const nextBtn = root.querySelector<HTMLButtonElement>("#value-next");
    if (prev) on(prev, "click", () => setValue(index - 1, { announce: true, scroll: true }));
    if (nextBtn) on(nextBtn, "click", () => setValue(index + 1, { announce: true, scroll: true }));

    // Scroll reveal
    const reveals = [...root.querySelectorAll<HTMLElement>(".reveal")];
    if (!("IntersectionObserver" in window)) reveals.forEach((r) => r.classList.add("is-visible"));
    else {
      const io = new IntersectionObserver(
        (entries) =>
          entries.forEach((en) => {
            if (en.isIntersecting) {
              en.target.classList.add("is-visible");
              io.unobserve(en.target);
            }
          }),
        { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
      );
      reveals.forEach((r) => io.observe(r));
      cleanups.push(() => io.disconnect());
    }
    return () => cleanups.forEach((c) => c());
  }, []);
  return null;
}
