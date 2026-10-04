// Renders one of ttl10's actual Material Symbols Outlined ligatures — see
// resources/views/app.blade.php for the font `<link>` (subsetted via
// `icon_names` to only the ligatures used below, ~5KB/weight instead of
// the ~4MB full variable font). Sized via `font-size` and colored via
// `color`, like any text — not `width`/`height`/`fill` the way an SVG
// icon component works, so callers pass Tailwind text-size/color classes
// through `className`, not h-*/w-*.
//
// The exact ligature names (and what ttl10 uses them for) this app
// currently renders:
//   frame_person       — citizen/mafia role badge, sheriff/don-check
//                         reveal results (tinted per outcome)
//   frame_person_mic    — nominate action ("accuse AND want to hear them
//                         speak again")
//   leak_add            — covert-signal trigger ("two points exchanging
//                         a signal", not "hidden" — deliberately not an
//                         eye-based icon)
//   visibility_lock     — don/sheriff check action, before it's been used
//   crop_free           — vote action reticle
//   motion_sensor_active — shoot action reticle
//   eye_tracking        — sender's own "signal just sent" pulse
// `style` accepts e.g. `{ fontVariationSettings: "'FILL' 1, 'wght' 700" }` —
// the font was loaded with the full wght/FILL/GRAD/opsz variable axes (see
// app.blade.php), so a caller wanting a bolder/filled icon (the seat
// action icons, made "significantly bigger and bolder" per direct
// request) can push those axes without needing a second font weight.
export default function MaterialIcon({ name, className = '', style = undefined }) {
    return (
        <span className={`material-symbols-outlined select-none leading-none ${className}`} style={style} aria-hidden="true">
            {name}
        </span>
    );
}
