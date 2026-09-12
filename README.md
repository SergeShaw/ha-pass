# HAPass guest lighting controls: visual evidence

Browser captures for [upstream PR #25](https://github.com/Rohithkadaveru/ha-pass/pull/25), recorded on 2026-09-12.

- Before: `ed90194b54863d661eea23bddd52387e89f23b08` (upstream main).
- After: `567040fcd8accace9c8526199e5645d014372d76` (feature branch).
- Real repository Jinja templates and static JavaScript, with CSS compiled using Tailwind 3.4.16 as pinned in the Dockerfile.
- Synthetic device states, command receiver and SSE stream supplied by `preview.py`. No live Home Assistant, home data or real access tokens are used.
- Captured with the Codex in-app browser. Viewports: 390 × 844 and 1280 × 900 for before/after; 320 × 740 for the narrow dark-theme check. Images are unedited browser captures; capture dimensions can exclude the scrollbar.

## Before / after

| 390 px viewport — before | 390 px viewport — after |
| --- | --- |
| ![Before: brightness controls](screenshots/before-mobile.jpg) | ![After: supported brightness, color and Kelvin controls](screenshots/after-mobile.jpg) |

| 1280 px viewport — before | 1280 px viewport — after |
| --- | --- |
| ![Desktop before](screenshots/before-desktop.jpg) | ![Desktop after](screenshots/after-desktop.jpg) |

![320 px viewport, dark theme](screenshots/after-320-dark.jpg)

## Results

- Inspected card padding, row spacing, text truncation and control alignment at 320, 390 and 1280 px. No overlapping controls or horizontal overflow was observed. At 320 px, all six active control rows had matching 248 px layout and scroll widths.
- Checked lights supporting RGB plus temperature, temperature only, brightness only, on/off only, off and unavailable states. Unsupported controls are absent in the feature version.
- Browser interaction sent `brightness: 194`, `color_temp_kelvin: 3100`, and `rgb_color: [51, 102, 204]` through the existing `light.turn_on` request shape to the synthetic receiver.
- An incoming SSE update did not move the focused Kelvin slider; after focus left the control, its value and label reconciled to the incoming 4222 K. Turning a light off removed its controls.
- This browser pass exposed a native range-input issue missed by the JavaScript tests: `step="100"` made a displayed 2703 K become a 2700 K input value and prevented reaching a 6536 K bound. The feature branch now uses integer-Kelvin steps. A fresh browser load confirmed 2703 K remained exact and keyboard Home/End reached 2000 K / 6536 K.
- No browser console warnings or errors were recorded during the final check. Fonts loaded.
- Final feature commit: 135 Python tests passed (32 existing httpx deprecation warnings); `node tests/test_light_controls.js` and `git diff --check` passed.

These checks establish rendering and browser-to-fixture behavior. Physical phones, native mobile color-picker dialogs, PWA installation, and live Home Assistant/light operation remain unverified.

## Reproduce the preview

Place exact checkouts in `before/` and `after/` beside `preview.py`, using the commits above. Build `static/dist.css` in each checkout with the repository's pinned Tailwind 3.4.16 and `tailwind.config.js`, and run `generate_icons.py` with Python 3.12. Use the dependencies in the repository's `requirements.txt`.

Run `python preview.py` and open `http://127.0.0.1:8765/g/before` and `http://127.0.0.1:8765/g/after`. The fixture binds only to loopback. `/preview/reset` resets only its in-memory synthetic states; `/preview/state/{variant}/{entity}` can inject a synthetic SSE update. Commands are recorded locally in `commands.jsonl` and never forwarded to Home Assistant.

This asset branch is separate from the product PR so screenshots and the preview harness do not enter the application diff.
