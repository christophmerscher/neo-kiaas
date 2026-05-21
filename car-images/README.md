# Car photos for the Fahrzeuge card view

Drop transparent PNG/WebP files in this directory and `neo-KIAS` will
display them on the model cards. The app discovers files on startup and
caches the list in the browser.

## Filename rules

Use the **model slug** as the filename:

| Model name shown in UI | Expected filename |
|---|---|
| Mondeo | `mondeo.png` |
| Fiesta | `fiesta.png` |
| Transit | `transit.png` |
| Transit Connect | `transit-connect.png` |
| Transit Courier | `transit-courier.png` |
| Transit Custom PHEV | `transit-custom-phev.png` |
| Mustang Mach-E | `mustang-mach-e.png` |
| C-Max | `c-max.png` |
| Ka Plus | `ka-plus.png` |
| Ford GT | `ford-gt.png` |
| S-Max | `s-max.png` |

Slug rules: lowercase, spaces → `-`, German umlauts mapped to ASCII
(`ä→a`, `ö→o`, `ü→u`, `ß→ss`), other special characters replaced with `-`,
runs of `-` collapsed, leading/trailing `-` stripped.

Supported extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`, `.gif`, `.avif`.

## Where to source

Anything you have rights to use. A few options:

- **Ford press kits** (https://media.ford.com) — high-res but check license.
- **Wikipedia / Wikimedia Commons** — typically CC-BY-SA, attribution required.
- **Background removal tools** — https://www.remove.bg, GIMP, Photoshop —
  for turning a photo with white/sky background into a transparent PNG.

## How it works

- Server endpoint `GET /api/car-images` lists all files in this directory.
- Server endpoint `GET /api/car-images/:file` serves a single file with a
  7-day browser cache header.
- Client compares the model name on each card to the slug list and
  renders the matching image when found; otherwise it shows the generic
  body-type silhouette.
- Empty or missing folder → all cards show silhouettes. No errors.

If you add new images while the app is running, refresh the browser to
pick them up.
