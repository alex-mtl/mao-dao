// Generates resources/css/themes.css from the canonical brand palette below
// (the same values as tailwind.config.js's light-warm scales, kept here as
// the single source of truth for theme generation).
//
// Regenerate with:
//   docker compose exec laravel.test node resources/css/generate-themes.mjs
//
// Design: every theme keeps the SAME hue for every brand/semantic scale
// (primary/secondary/accent/success/warning/danger/info) — only lightness
// curves and neutral (warm/ink) hue shift between themes ("systematic
// variants", not new brand identities). Dark themes are built by reversing
// each scale's shade->lightness mapping by position (shade 50 gets what
// shade 950 used to have, 100<->900, etc.), which preserves the invariant
// "higher shade number = lighter" in every theme — the thing component
// code actually depends on (e.g. `border-warm-300` reads slightly lighter
// than `bg-warm-100` in every theme) — while making high-emphasis text
// (`ink-900`) light-on-dark and light badge backgrounds (`primary-100`)
// become dark-tinted, matching normal dark-UI idioms, with no per-scale
// special-casing needed.

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

const BASE = {
    primary: { 50: '#F1F1FF', 100: '#E3E4FF', 200: '#C8CAFF', 300: '#A6A8FE', 400: '#8285FB', 500: '#6265F5', 600: '#4C4FE8', 700: '#3E40C7', 800: '#34359F', 900: '#2C2D7D', 950: '#1B1B4D' },
    secondary: { 50: '#FFF4EE', 100: '#FFE6D9', 200: '#FFC9AF', 300: '#FFA47C', 400: '#FF7F4D', 500: '#FB5F2A', 600: '#E6491A', 700: '#BF3814', 800: '#992E17', 900: '#7C2916', 950: '#431106' },
    accent: { 50: '#ECFDF6', 100: '#D2FAE9', 200: '#A7F3D6', 300: '#6FE6BE', 400: '#3ED2A4', 500: '#1FB88C', 600: '#159473', 700: '#14765F', 800: '#145E4E', 900: '#124E42', 950: '#062C25' },
    success: { 50: '#ECFDF5', 100: '#D1FAE5', 200: '#A7F3D0', 300: '#6EE7B7', 400: '#34D399', 500: '#10B981', 600: '#059669', 700: '#047857', 800: '#065F46', 900: '#064E3B', 950: '#022C22' },
    warning: { 50: '#FFFBEB', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D', 400: '#FBBF24', 500: '#F59E0B', 600: '#D97706', 700: '#B45309', 800: '#92400E', 900: '#78350F', 950: '#451A03' },
    danger: { 50: '#FEF2F2', 100: '#FEE2E2', 200: '#FECACA', 300: '#FCA5A5', 400: '#F87171', 500: '#EF4444', 600: '#DC2626', 700: '#B91C1C', 800: '#991B1B', 900: '#7F1D1D', 950: '#450A0A' },
    info: { 50: '#F0F9FF', 100: '#E0F2FE', 200: '#BAE6FD', 300: '#7DD3FC', 400: '#38BDF8', 500: '#0EA5E9', 600: '#0284C7', 700: '#0369A1', 800: '#075985', 900: '#0C4A6E', 950: '#082F49' },
    warm: { 50: '#FDFCFA', 100: '#FAF8F4', 200: '#F3F0EA', 300: '#E8E4DC', 400: '#D6D0C4', 500: '#B8B0A0', 600: '#948B7A', 700: '#6F6858', 800: '#4F4A3F', 900: '#37332B', 950: '#201D18' },
    ink: { 50: '#F4F5F7', 100: '#E7E9ED', 200: '#CBCEDA', 300: '#A3A8BD', 400: '#767C99', 500: '#565C7D', 600: '#3F4463', 700: '#2E3250', 800: '#1F2238', 900: '#14162A', 950: '#0A0B16' },
};

const BRAND_KEYS = ['primary', 'secondary', 'accent', 'success', 'warning', 'danger', 'info'];
const NEUTRAL_KEYS = ['warm', 'ink'];
const ALL_KEYS = [...BRAND_KEYS, ...NEUTRAL_KEYS];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s;
    const l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h /= 6;
    }
    return [h * 360, s * 100, l * 100];
}

function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    s /= 100; l /= 100;
    if (s === 0) {
        const v = Math.round(l * 255);
        return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
    ];
}

const rgbTriplet = ([r, g, b]) => `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
const hslTriplet = (h, s, l) => rgbTriplet(hslToRgb(h, s, l));

// Reindex a scale by position: new[shade[i]] = old[shade[N-1-i]].
// Preserves "higher shade number = lighter" in every theme.
function reversePosition(scale) {
    const out = {};
    SHADES.forEach((shade, i) => {
        out[shade] = scale[SHADES[10 - i]];
    });
    return out;
}

// Recolor every shade to a target hue/saturation while keeping that
// shade's original lightness (so the existing contrast steps survive).
function recolorKeepLightness(scale, hue, sat) {
    const out = {};
    for (const shade of SHADES) {
        const [r, g, b] = hexToRgb(scale[shade]);
        const [, , l] = rgbToHsl(r, g, b);
        out[shade] = hslToRgb(hue, sat, l);
    }
    return out;
}

// Nudge every shade's saturation/lightness by a delta (light-soft's
// "gentler" brand colors).
function softenScale(scale, { ds = 0, dl = 0 } = {}) {
    const out = {};
    for (const shade of SHADES) {
        const v = scale[shade];
        const [r, g, b] = typeof v === 'string' ? hexToRgb(v) : v;
        const [h, s, l] = rgbToHsl(r, g, b);
        out[shade] = hslToRgb(h, clamp(s + ds, 0, 100), clamp(l + dl, 0, 100));
    }
    return out;
}

// True lightness inversion (newL = 100 - L), recolored to a target hue/sat.
// Unlike reversePosition (which keeps shade 500 anchored to its own
// original lightness — fine for the `warm` background/border scale, and
// intentional for brand colors, which should stay visually similar in
// every theme), text needs every shade's CONTRAST relationship flipped,
// not just the extremes: `ink-500` is "medium-muted body text" on a light
// background (~41% lightness, high contrast against a ~100% white card).
// reversePosition would leave it at that same ~41% in a dark theme, which
// is unreadable against a ~20-27% dark surface (real contrast ratio
// ~1.8:1, needs ~4.5:1). Inverting the value instead lifts it to ~59%,
// preserving "medium-muted" as a relationship rather than an absolute L.
function invertLightness(scale, hue, sat, { lift = 0 } = {}) {
    const out = {};
    for (const shade of SHADES) {
        const [r, g, b] = hexToRgb(scale[shade]);
        const [, , l] = rgbToHsl(r, g, b);
        out[shade] = hslToRgb(hue, sat, clamp(100 - l + lift, 4, 97));
    }
    return out;
}

function toRgbScale(scale) {
    // Normalize a scale that may hold hex strings or [r,g,b] arrays into rgb arrays.
    const out = {};
    for (const shade of SHADES) {
        const v = scale[shade];
        out[shade] = typeof v === 'string' ? hexToRgb(v) : v;
    }
    return out;
}

function brandBase() {
    const scales = {};
    for (const key of BRAND_KEYS) scales[key] = toRgbScale(BASE[key]);
    return scales;
}

// A scale defined directly by a lightness curve at one hue/saturation.
function scaleFromL(hue, sat, lightnesses) {
    const out = {};
    SHADES.forEach((shade, i) => {
        out[shade] = hslToRgb(hue, sat, lightnesses[i]);
    });
    return out;
}

const THEMES = {
    'light-warm': () => {
        const scales = {};
        for (const key of ALL_KEYS) scales[key] = toRgbScale(BASE[key]);
        return { scales, surface: [255, 255, 255], shadowTint: [20, 22, 56] };
    },

    // Each non-default theme now has its OWN brand hues (primary/secondary/
    // accent recolored, lightness curve preserved) instead of only shifting
    // neutrals — the earlier "same hue everywhere" approach made the five
    // themes read as near-identical. Semantic scales (success/warning/
    // danger/info) keep their meaning-bearing hues in every theme.
    'light-cool': () => {
        const scales = brandBase();
        scales.primary = recolorKeepLightness(BASE.primary, 196, 92); // ocean blue
        scales.secondary = recolorKeepLightness(BASE.secondary, 32, 92); // amber
        scales.accent = recolorKeepLightness(BASE.accent, 168, 70); // teal
        scales.warm = recolorKeepLightness(BASE.warm, 205, 28);
        scales.ink = recolorKeepLightness(BASE.ink, 215, 40);
        return { scales, surface: hslToRgb(205, 45, 99), shadowTint: hslToRgb(215, 55, 14) };
    },

    'light-soft': () => {
        const scales = brandBase();
        scales.primary = softenScale(recolorKeepLightness(BASE.primary, 338, 70), { ds: -8, dl: 4 }); // rose
        scales.secondary = softenScale(recolorKeepLightness(BASE.secondary, 268, 60), { ds: -6, dl: 4 }); // lilac
        scales.accent = softenScale(recolorKeepLightness(BASE.accent, 140, 45), { ds: -4, dl: 3 }); // sage
        scales.warm = recolorKeepLightness(BASE.warm, 24, 38); // peach cream
        scales.ink = recolorKeepLightness(BASE.ink, 330, 14);
        return { scales, surface: hslToRgb(30, 60, 98), shadowTint: hslToRgb(340, 30, 30) };
    },

    'dark-warm': () => {
        const scales = brandBase();
        scales.primary = recolorKeepLightness(BASE.primary, 28, 92); // amber-orange
        scales.secondary = recolorKeepLightness(BASE.secondary, 350, 85); // rose
        scales.accent = recolorKeepLightness(BASE.accent, 88, 62); // olive-lime
        for (const key of ['primary', 'secondary', 'accent']) scales[key] = reversePosition(scales[key]);
        for (const key of ['success', 'warning', 'danger', 'info']) scales[key] = reversePosition(scales[key]);
        scales.warm = reversePosition(recolorKeepLightness(BASE.warm, 24, 26));
        // +14 lift: pure inversion left mid-tones (e.g. ink-500, used for
        // secondary/muted body text) at only ~3.2:1 contrast against the
        // surface/page bg — under the 4.5:1 WCAG AA text threshold.
        scales.ink = invertLightness(BASE.ink, 32, 16, { lift: 14 });
        // Surface (card bg) must read lighter than the page bg (warm-100,
        // itself the reversed warm-800 ~L28%) so cards still look "elevated"
        // toward the light, same relationship as the light themes' white-on-warm.
        return { scales, surface: hslToRgb(24, 22, 24), shadowTint: [0, 0, 0] };
    },

    'dark-cool': () => {
        const scales = brandBase();
        scales.primary = recolorKeepLightness(BASE.primary, 266, 88); // violet
        scales.secondary = recolorKeepLightness(BASE.secondary, 188, 85); // cyan
        scales.accent = recolorKeepLightness(BASE.accent, 320, 65); // orchid
        for (const key of BRAND_KEYS) scales[key] = reversePosition(scales[key]);
        scales.warm = reversePosition(recolorKeepLightness(BASE.warm, 228, 30));
        scales.ink = invertLightness(BASE.ink, 224, 30, { lift: 14 });
        return { scales, surface: hslToRgb(228, 28, 22), shadowTint: [0, 0, 0] };
    },

    // Ultra-neon, modeled on the TikTok "Guess the Word" overlay
    // (election-game/app/web/common/neon.css): near-black violet page,
    // magenta/cyan/lime light sources. Scales are written directly as a
    // lightness curve (higher shade = lighter, as in every dark theme).
    // Fonts, glows and dark-text-on-bright-buttons live in app.css.
    'dark-neon': () => {
        const L_BRAND = [9, 14, 21, 52, 57, 60, 64, 70, 78, 88, 95];
        const scales = {
            primary: scaleFromL(312, 100, L_BRAND), // hot magenta
            secondary: scaleFromL(184, 100, L_BRAND), // electric cyan
            accent: scaleFromL(108, 100, L_BRAND), // lime
            success: scaleFromL(130, 95, L_BRAND),
            warning: scaleFromL(52, 100, L_BRAND), // yellow
            danger: scaleFromL(348, 100, L_BRAND), // neon pink-red
            info: scaleFromL(212, 100, L_BRAND),
            warm: scaleFromL(268, 62, [4, 6, 12, 19, 29, 44, 56, 68, 79, 89, 95]), // violet-black
            ink: scaleFromL(262, 55, [10, 16, 26, 42, 64, 77, 84, 90, 95, 98, 99]), // lavender-white
        };
        return { scales, surface: hslToRgb(268, 72, 10), shadowTint: hslToRgb(280, 100, 60) };
    },
};

function renderBlock(selector, theme) {
    const lines = [`${selector} {`];
    for (const key of ALL_KEYS) {
        for (const shade of SHADES) {
            lines.push(`    --color-${key}-${shade}: ${rgbTriplet(theme.scales[key][shade])};`);
        }
    }
    lines.push(`    --color-surface: ${rgbTriplet(theme.surface)};`);
    lines.push(`    --shadow-tint: ${rgbTriplet(theme.shadowTint)};`);
    lines.push('}');
    return lines.join('\n');
}

const order = ['light-warm', 'light-cool', 'light-soft', 'dark-warm', 'dark-cool', 'dark-neon'];
const blocks = order.map((name) => {
    const theme = THEMES[name]();
    return renderBlock(`[data-theme="${name}"]`, theme);
});
// :root also gets light-warm's values directly (not just via attribute
// selector) so the app still has a sane default theme before any
// `data-theme` attribute is present (e.g. a nested swatch preview element
// that explicitly sets data-theme="light-warm" needs its OWN rule to
// override an ancestor's different theme — inheriting from :root alone
// isn't enough once something else has already overridden it above it).
blocks.unshift(renderBlock(':root', THEMES['light-warm']()));

const header = `/*
 * Generated by resources/css/generate-themes.mjs — do not hand-edit.
 * Regenerate with: docker compose exec laravel.test node resources/css/generate-themes.mjs
 *
 * Each block defines the same set of --color-*-<shade> custom properties
 * (space-separated "R G B" triplets, for Tailwind's rgb(var(...) / <alpha-value>)
 * pattern) plus --color-surface and --shadow-tint. :root holds the default
 * theme (light-warm); [data-theme="..."] blocks override it.
 */`;

const output = [header, ...blocks].join('\n\n') + '\n';

const fs = await import('node:fs');
const path = await import('node:path');
const { fileURLToPath } = await import('node:url');
const outPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'themes.css');
fs.writeFileSync(outPath, output);
console.log(`Wrote ${outPath} (${order.length} themes, ${ALL_KEYS.length * SHADES.length + 2} vars each)`);
