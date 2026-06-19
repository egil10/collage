# 🖼️ Collage

A dead-simple, browser-based collage maker. Drop in a pile of images, pick a paper
size, drag the borders around until it looks right, and download a high-resolution,
print-ready image.

**No upload, no account, no build step** — it's a single static page and everything
runs locally in your browser. Your photos never leave your device.

## Features

- **Drop in many images at once** (jpg, png, webp, gif…) — drag onto the page or click *Add*.
- **Paper sizes:** A3 / A4 / A5, portrait or landscape. (These share the ISO 1:√2 shape;
  the size sets the **export resolution** — e.g. A4 @ 300 DPI = 2480 × 3508 px.)
- **Auto layout** that picks a tidy grid for however many photos you have — or set the
  column count yourself.
- **Drag the borders** between photos to resize cells. Adjust border thickness, outer
  margin, corner radius and border colour.
- **Reframe each photo:** drag inside a cell to reposition, scroll to zoom, double-click to reset.
- **Reorder** by dragging thumbnails in the tray; *Shuffle* / *Reverse* / *Clear*.
- **Download** as PNG or JPG at 150 or 300 DPI. What you see is exactly what you get
  (preview and export use the same canvas renderer).

## Use it

- **Online:** open the deployed site (Vercel).
- **Locally:** just open `index.html` in a browser — no server or install needed.

## Develop / run locally

It's plain HTML/CSS/JS with zero dependencies. Open `index.html` directly, or serve the
folder:

```bash
npx serve .
# or
python -m http.server
```

## Deploy

Static site, no framework. On [Vercel](https://vercel.com): import the repo (or run
`vercel`) and deploy with **no build command** and the project root as the output
directory.

## How borders work

The collage is a set of rows; each row splits into cells. Dragging a **vertical** line
re-weights the two cells beside it within that row; dragging a **horizontal** line
re-weights the two rows. Thickness is the *border* slider (in mm), and the gaps show the
*border colour* — so a 0 mm border makes photos touch edge-to-edge.
