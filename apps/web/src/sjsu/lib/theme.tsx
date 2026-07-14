import { useSyncExternalStore } from "react";

// SJSU theme store: module-level pub-sub, not Context, because Context re-renders
// Shell/Outlet/the whole route per toggle (~400-600ms). applying `.dark`
// imperatively re-renders only the icon; AppLayout's callback ref avoids first-paint flash.
type Theme = "light" | "dark";

// base color scale, orthogonal to light/dark. "neutral" is the theme.s default gray,
// "slate" is the slate scale (.sjsu-theme.surface-slate in sjsu.css). picker in settings, Appearance.
type Palette = "neutral" | "slate";

const THEME_KEY = "sjsu-theme";
const COLOR_BLIND_SAFE_KEY = "sjsu-color-blind-safe";
const PALETTE_KEY = "sjsu-palette";

// Write a pref, swallowing the throw private-mode / disabled-storage raises.
function writePrefToStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable (private mode etc) - non-fatal
  }
}

let themeWrapperEl: HTMLElement | null = null;
const subscribers = new Set<() => void>();

// bundles get/set/seed/use for one pref: seed from localStorage at load, write
// through on set, share one listener set so a snapshot mismatch gates re-renders.
// parse/serialize default to string; boolean prefs pass their own for "true"/"false".
function createPreference<T extends string | boolean>(options: {
  key: string;
  fallback: T;
  deserialize?: (raw: string) => T;
  serialize?: (value: T) => string;
}) {
  const { key, fallback } = options;
  const deserialize = options.deserialize ?? ((raw: string) => raw as T);
  const serialize = options.serialize ?? ((value: T) => String(value));

  // SSR-safe seed: fall back when window is absent or the key is unset.
  let currentValue: T = fallback;
  if (typeof window !== "undefined") {
    const rawValue = localStorage.getItem(key);
    if (rawValue !== null) currentValue = deserialize(rawValue);
  }

  const get = () => currentValue;

  // bypasses the change-guard and persistence - used for url-param seeding
  // before the first syncThemeClasses (see registerWrapper).
  const seedValue = (next: T) => {
    currentValue = next;
  };

  const set = (nextValue: T, persist = true) => {
    if (nextValue === currentValue) return;
    withoutTransitions(() => {
      currentValue = nextValue;
      if (persist) writePrefToStorage(key, serialize(currentValue));
      syncThemeClasses();
      subscribers.forEach((notify) => notify());
    });
  };

  const use = () => useSyncExternalStore(subscribe, get, () => fallback);

  return { get, set, seedValue, use };
}

const themeStore = createPreference<Theme>({ key: THEME_KEY, fallback: "light" });
const paletteStore = createPreference<Palette>({
  key: PALETTE_KEY,
  fallback: "neutral",
});
// colorblind-safe status palette. swaps only the status triples via the
// `colorblind-safe` class (see sjsu.css). boolean, so it carries its own
// parse/serialize.
const colorBlindStore = createPreference<boolean>({
  key: COLOR_BLIND_SAFE_KEY,
  fallback: false,
  deserialize: (raw) => raw === "true",
});

function syncThemeClasses() {
  const classToggles: Record<string, boolean> = {
    dark: themeStore.get() === "dark",
    "colorblind-safe": colorBlindStore.get(),
    "surface-slate": paletteStore.get() === "slate",
  };
  // real theme classes take over from the index.html boot-dark guard
  document.getElementById("root")?.classList.remove("boot-dark");
  // Radix portals mount to document.body, outside `.sjsu-theme`. Keep the body
  // class in sync so portaled UI (Toaster, Dialog, Popover, Tooltip) reads
  // the same tokens as the rest of the theme.
  document.body.classList.add("sjsu-theme");
  for (const el of [themeWrapperEl, document.body]) {
    if (!el) continue;
    for (const [className, isOn] of Object.entries(classToggles)) el.classList.toggle(className, isOn);
  }
}

// AppLayout's callback ref: non-null applies theme synchronously (no flash), null
// on unmount strips body classes so the base app stay untouched. readUrlParam lets
// EmbedLayout seed ?theme=light|dark (extension) without touching localStorage.
export function registerWrapper(
  element: HTMLElement | null,
  opts: { readUrlParam?: boolean } = {},
) {
  if (!element) {
    themeWrapperEl = null;
    document.body.classList.remove(
      "sjsu-theme",
      "dark",
      "colorblind-safe",
      "surface-slate",
    );
    return;
  }
  if (opts.readUrlParam) {
    const urlTheme = new URLSearchParams(window.location.search).get("theme");
    if (urlTheme === "light" || urlTheme === "dark") {
      themeStore.seedValue(urlTheme);
    }
  }
  themeWrapperEl = element;
  syncThemeClasses();
}

// one-frame `transition: none !important` around palette flips so shadcn children
// don't re-animate while plain containers snap (torn mixed-palette frame).
// same idea as next-themes' disableTransitionOnChange.
function withoutTransitions(applyChange: () => void) {
  const styleEl = document.createElement("style");
  styleEl.append(
    document.createTextNode("*,*::before,*::after{transition:none !important}"),
  );
  document.head.appendChild(styleEl);

  applyChange();

  requestAnimationFrame(() => {
    getComputedStyle(document.body); // flush so the guard applies before paint
    requestAnimationFrame(() => {
      document.head.removeChild(styleEl);
    });
  });
}

function subscribe(notify: () => void) {
  subscribers.add(notify);
  return () => {
    subscribers.delete(notify);
  };
}

// persist: writes through to localStorage. Set false for embed/iframe
// contexts (extension postMessage) so the iframe's theme flip doesn't bleed
// into the user's main-app preference.
export function setTheme(nextValue: Theme, opts: { persist?: boolean } = {}) {
  themeStore.set(nextValue, opts.persist ?? true);
}

export function useTheme() {
  const theme = themeStore.use();
  return {
    theme,
    toggle: () => themeStore.set(theme === "light" ? "dark" : "light"),
  };
}

export function setColorBlindSafe(next: boolean) {
  colorBlindStore.set(next);
}

export function useColorBlindSafe() {
  const colorBlindSafe = colorBlindStore.use();
  return { colorBlindSafe, setColorBlindSafe };
}

export function setPalette(next: Palette) {
  paletteStore.set(next);
}

export function usePalette() {
  const palette = paletteStore.use();
  return { palette, setPalette };
}
