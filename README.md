# Mermaid Pan & Zoom

GitHub-like pan and zoom for Mermaid diagrams in Obsidian.

Obsidian's default Mermaid rendering clips large diagrams to the note width with awkward horizontal scrolling. This plugin wraps each diagram in an interactive viewport with proper pan/zoom controls.

## Features

- **Scroll to zoom** — zooms toward cursor position
- **Click and drag** to pan
- **Double-click** to fit diagram to view
- **Touch support** — pinch to zoom, drag to pan
- **GitHub-style controls** — toolbar appears on hover (zoom in/out, fit, reset)
- **Zoom label** — shows current zoom percentage
- **Crisp at any zoom** — manipulates the SVG viewBox directly instead of CSS transforms, so the browser re-renders vector paths at native resolution

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Container height | 500px | Height of the diagram viewport |
| Zoom speed | 0.002 | Mouse wheel sensitivity |
| Min zoom | 0.1 (10%) | Lower zoom bound |
| Max zoom | 10 (1000%) | Upper zoom bound |
| Show controls | On | Toggle the hover toolbar |

## Install

### Manual

1. Clone this repo
2. `npm install && npm run build`
3. Copy `main.js`, `styles.css`, and `manifest.json` to `<vault>/.obsidian/plugins/mermaid-pan-zoom/`
4. Enable "Mermaid Pan & Zoom" in Settings → Community Plugins

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
```

## License

MIT
