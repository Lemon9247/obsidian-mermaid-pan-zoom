import { Plugin, PluginSettingTab, App, Setting } from "obsidian";

interface MermaidPanZoomSettings {
    containerHeight: number;
    minZoom: number;
    maxZoom: number;
    zoomSpeed: number;
    showControls: boolean;
}

const DEFAULT_SETTINGS: MermaidPanZoomSettings = {
    containerHeight: 500,
    minZoom: 0.1,
    maxZoom: 10,
    zoomSpeed: 0.002,
    showControls: true,
};

/**
 * ViewBox-based pan/zoom state.
 *
 * Instead of CSS transforms (which rasterize then scale → blurry),
 * we manipulate the SVG viewBox directly. The browser re-renders
 * the vector paths at native resolution for every zoom level.
 *
 * The viewBox always matches the container's aspect ratio so there's
 * no letterboxing. At fit-to-view, it's sized to contain the full diagram.
 */
interface ViewState {
    // Current viewBox origin (SVG coordinate space)
    vbX: number;
    vbY: number;
    // Current viewBox dimensions (smaller = more zoomed in)
    vbW: number;
    vbH: number;
    // Base viewBox at fit-to-view (for scale reference)
    baseX: number;
    baseY: number;
    baseW: number;
    baseH: number;
    // Natural diagram bounds from the original viewBox
    naturalW: number;
    naturalH: number;
}

const ICONS = {
    zoomIn: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9-3a1 1 0 0 0-2 0v2H5a1 1 0 0 0 0 2h2v2a1 1 0 0 0 2 0V9h2a1 1 0 0 0 0-2H9V5Z"/></svg>`,
    zoomOut: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm4 1a1 1 0 0 1 0-2h8a1 1 0 0 1 0 2H4Z"/></svg>`,
    fitView: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1 1h5v2H3.414L6 5.586 4.586 7 2 4.414V6H0V1h1Zm14 0h-5v2h2.586L10 5.586 11.414 7 14 4.414V6h2V1h-1ZM1 15h5v-2H3.414L6 10.414 4.586 9 2 11.586V10H0v5h1Zm14 0h-5v-2h2.586L10 10.414 11.414 9 14 11.586V10h2v5h-1Z"/></svg>`,
    reset: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.05 3.05a7 7 0 1 1 .02 9.88l1.43-1.43a5.001 5.001 0 1 0-.02-7.01L6 6H1V1l2.05 2.05Z"/></svg>`,
};

export default class MermaidPanZoomPlugin extends Plugin {
    settings: MermaidPanZoomSettings = DEFAULT_SETTINGS;
    private processedDivs = new WeakSet<HTMLElement>();
    private pendingProcess = new Set<HTMLElement>();
    private debounceTimer: number | null = null;

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new MermaidPanZoomSettingTab(this.app, this));
        this.registerMermaidObserver();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private registerMermaidObserver() {
        const observer = new MutationObserver(() => {
            const divs = document.querySelectorAll<HTMLElement>("div.mermaid");
            for (const div of Array.from(divs)) {
                if (this.processedDivs.has(div)) continue;
                if (div.closest(".mpz-wrapper")) continue;

                const svg = div.querySelector("svg");
                if (!svg || svg.childElementCount === 0) continue;

                this.pendingProcess.add(div);
            }

            if (this.pendingProcess.size > 0) {
                if (this.debounceTimer !== null) {
                    window.clearTimeout(this.debounceTimer);
                }
                this.debounceTimer = window.setTimeout(() => {
                    this.processPending();
                    this.debounceTimer = null;
                }, 150);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        this.register(() => observer.disconnect());

        // Initial scan for already-rendered diagrams
        setTimeout(() => {
            const divs = document.querySelectorAll<HTMLElement>("div.mermaid");
            for (const div of Array.from(divs)) {
                if (this.processedDivs.has(div)) continue;
                const svg = div.querySelector("svg");
                if (svg && svg.childElementCount > 0) {
                    this.pendingProcess.add(div);
                }
            }
            if (this.pendingProcess.size > 0) this.processPending();
        }, 500);
    }

    private processPending() {
        for (const div of this.pendingProcess) {
            if (this.processedDivs.has(div)) continue;
            if (!div.isConnected) continue;
            const svg = div.querySelector("svg");
            if (!svg || svg.childElementCount === 0) continue;

            this.processedDivs.add(div);
            this.wrapWithPanZoom(div, svg);
        }
        this.pendingProcess.clear();
    }

    private wrapWithPanZoom(mermaidDiv: HTMLElement, svg: SVGElement) {
        const settings = this.settings;

        // --- Build wrapper around the existing mermaid div ---
        const wrapper = document.createElement("div");
        wrapper.className = "mpz-wrapper";

        const viewport = document.createElement("div");
        viewport.className = "mpz-viewport";
        viewport.style.height = `${settings.containerHeight}px`;

        mermaidDiv.parentNode!.insertBefore(wrapper, mermaidDiv);
        viewport.appendChild(mermaidDiv);
        wrapper.appendChild(viewport);

        mermaidDiv.classList.add("mpz-content");

        // --- Extract natural SVG dimensions ---
        const origWidth = svg.getAttribute("width");
        const origHeight = svg.getAttribute("height");
        let origVB = svg.getAttribute("viewBox");

        if (!origVB && origWidth && origHeight) {
            const w = parseFloat(origWidth);
            const h = parseFloat(origHeight);
            if (!isNaN(w) && !isNaN(h)) {
                origVB = `0 0 ${w} ${h}`;
                svg.setAttribute("viewBox", origVB);
            }
        }

        if (!origVB) return; // Can't work without a viewBox

        const [, , naturalW, naturalH] = origVB.split(/[\s,]+/).map(Number);
        if (!naturalW || !naturalH) return;

        // SVG fills the viewport — no fixed dimensions, no preserveAspectRatio
        // We control the visible region entirely through viewBox.
        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.removeAttribute("preserveAspectRatio");
        svg.style.width = "100%";
        svg.style.height = "100%";
        mermaidDiv.style.overflow = "visible";

        // --- Compute base viewBox (fit-to-view) ---
        // The viewBox must match the container's aspect ratio so the SVG
        // fills it without letterboxing. We size it to contain the full diagram.
        const computeBase = (): Pick<ViewState, "baseX" | "baseY" | "baseW" | "baseH"> => {
            const containerW = viewport.clientWidth || 1;
            const containerH = viewport.clientHeight || 1;
            const cAspect = containerW / containerH;
            const dAspect = naturalW / naturalH;

            let baseW: number, baseH: number;
            if (dAspect > cAspect) {
                // Diagram is wider than container ratio — fit by width
                baseW = naturalW;
                baseH = naturalW / cAspect;
            } else {
                // Diagram is taller — fit by height
                baseH = naturalH;
                baseW = naturalH * cAspect;
            }

            // Center the diagram within the viewBox
            const baseX = -(baseW - naturalW) / 2;
            const baseY = -(baseH - naturalH) / 2;

            return { baseX, baseY, baseW, baseH };
        };

        const base = computeBase();
        const state: ViewState = {
            vbX: base.baseX,
            vbY: base.baseY,
            vbW: base.baseW,
            vbH: base.baseH,
            ...base,
            naturalW,
            naturalH,
        };

        const applyViewBox = () => {
            svg.setAttribute("viewBox", `${state.vbX} ${state.vbY} ${state.vbW} ${state.vbH}`);
        };

        const getScale = () => state.baseW / state.vbW;

        const fitToView = () => {
            const base = computeBase();
            Object.assign(state, base);
            state.vbX = base.baseX;
            state.vbY = base.baseY;
            state.vbW = base.baseW;
            state.vbH = base.baseH;
            applyViewBox();
            updateZoomLabel();
        };

        const resetView = () => {
            state.vbX = state.baseX;
            state.vbY = state.baseY;
            state.vbW = state.baseW;
            state.vbH = state.baseH;
            applyViewBox();
            updateZoomLabel();
        };

        // --- Controls ---
        let zoomLabel: HTMLElement | null = null;

        const updateZoomLabel = () => {
            if (zoomLabel) {
                zoomLabel.textContent = `${Math.round(getScale() * 100)}%`;
            }
        };

        if (settings.showControls) {
            const controls = document.createElement("div");
            controls.className = "mpz-controls";

            const makeBtn = (icon: string, title: string, onClick: () => void) => {
                const btn = document.createElement("button");
                btn.className = "mpz-btn";
                btn.innerHTML = icon;
                btn.setAttribute("aria-label", title);
                btn.title = title;
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onClick();
                });
                return btn;
            };

            controls.appendChild(
                makeBtn(ICONS.zoomIn, "Zoom in", () => {
                    zoomAtCenter(1.3);
                })
            );
            controls.appendChild(
                makeBtn(ICONS.zoomOut, "Zoom out", () => {
                    zoomAtCenter(1 / 1.3);
                })
            );
            controls.appendChild(makeBtn(ICONS.fitView, "Fit to view", fitToView));
            controls.appendChild(makeBtn(ICONS.reset, "Reset (100%)", resetView));

            zoomLabel = document.createElement("span");
            zoomLabel.className = "mpz-zoom-label";
            zoomLabel.textContent = "100%";
            controls.appendChild(zoomLabel);

            wrapper.appendChild(controls);
        }

        // --- Zoom toward a screen point ---
        const zoomAtScreen = (screenX: number, screenY: number, factor: number) => {
            const currentScale = getScale();
            const newScale = clamp(currentScale * factor, settings.minZoom, settings.maxZoom);
            if (newScale === currentScale) return;

            const rect = viewport.getBoundingClientRect();
            // Cursor position as fraction of container [0..1]
            const fracX = (screenX - rect.left) / rect.width;
            const fracY = (screenY - rect.top) / rect.height;

            // The SVG-space point under the cursor
            const svgX = state.vbX + fracX * state.vbW;
            const svgY = state.vbY + fracY * state.vbH;

            // New viewBox dimensions
            const newVbW = state.baseW / newScale;
            const newVbH = state.baseH / newScale;

            // Adjust origin so svgX,svgY stays at the same screen fraction
            state.vbW = newVbW;
            state.vbH = newVbH;
            state.vbX = svgX - fracX * newVbW;
            state.vbY = svgY - fracY * newVbH;

            applyViewBox();
            updateZoomLabel();
        };

        const zoomAtCenter = (factor: number) => {
            const rect = viewport.getBoundingClientRect();
            zoomAtScreen(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
        };

        // --- Mouse wheel zoom ---
        viewport.addEventListener(
            "wheel",
            (e) => {
                e.preventDefault();
                e.stopPropagation();
                const delta = -e.deltaY * settings.zoomSpeed;
                const factor = Math.exp(delta);
                zoomAtScreen(e.clientX, e.clientY, factor);
            },
            { passive: false }
        );

        // --- Mouse drag pan ---
        let isDragging = false;
        let dragStartX = 0;
        let dragStartY = 0;
        let vbStartX = 0;
        let vbStartY = 0;

        viewport.addEventListener("mousedown", (e) => {
            if (e.button !== 0) return;
            isDragging = true;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            vbStartX = state.vbX;
            vbStartY = state.vbY;
            viewport.classList.add("mpz-grabbing");
            e.preventDefault();
        });

        const onMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const rect = viewport.getBoundingClientRect();
            // Convert pixel drag distance to SVG-space distance
            const dx = ((e.clientX - dragStartX) / rect.width) * state.vbW;
            const dy = ((e.clientY - dragStartY) / rect.height) * state.vbH;
            // Pan is inverted: dragging right moves viewBox left
            state.vbX = vbStartX - dx;
            state.vbY = vbStartY - dy;
            applyViewBox();
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                viewport.classList.remove("mpz-grabbing");
            }
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        this.register(() => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        });

        // --- Touch: pinch zoom + drag pan ---
        let lastTouchDist = 0;
        let lastTouchCenter = { x: 0, y: 0 };
        let isTouchPanning = false;
        let touchVbStartX = 0;
        let touchVbStartY = 0;
        let touchDragStartX = 0;
        let touchDragStartY = 0;

        viewport.addEventListener(
            "touchstart",
            (e) => {
                if (e.touches.length === 2) {
                    e.preventDefault();
                    lastTouchDist = getTouchDistance(e.touches);
                    lastTouchCenter = getTouchCenter(e.touches);
                } else if (e.touches.length === 1) {
                    isTouchPanning = true;
                    touchDragStartX = e.touches[0].clientX;
                    touchDragStartY = e.touches[0].clientY;
                    touchVbStartX = state.vbX;
                    touchVbStartY = state.vbY;
                }
            },
            { passive: false }
        );

        viewport.addEventListener(
            "touchmove",
            (e) => {
                const rect = viewport.getBoundingClientRect();
                if (e.touches.length === 2) {
                    e.preventDefault();
                    const dist = getTouchDistance(e.touches);
                    const center = getTouchCenter(e.touches);
                    const factor = dist / lastTouchDist;

                    zoomAtScreen(center.x, center.y, factor);

                    // Also pan with center movement
                    const dx = ((center.x - lastTouchCenter.x) / rect.width) * state.vbW;
                    const dy = ((center.y - lastTouchCenter.y) / rect.height) * state.vbH;
                    state.vbX -= dx;
                    state.vbY -= dy;
                    applyViewBox();

                    lastTouchDist = dist;
                    lastTouchCenter = center;
                } else if (e.touches.length === 1 && isTouchPanning) {
                    e.preventDefault();
                    const dx = ((e.touches[0].clientX - touchDragStartX) / rect.width) * state.vbW;
                    const dy = ((e.touches[0].clientY - touchDragStartY) / rect.height) * state.vbH;
                    state.vbX = touchVbStartX - dx;
                    state.vbY = touchVbStartY - dy;
                    applyViewBox();
                }
            },
            { passive: false }
        );

        viewport.addEventListener("touchend", () => {
            isTouchPanning = false;
            lastTouchDist = 0;
        });

        // --- Double-click to fit ---
        viewport.addEventListener("dblclick", (e) => {
            e.preventDefault();
            fitToView();
        });

        // Initial fit
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                fitToView();
            });
        });
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touches: TouchList): { x: number; y: number } {
    return {
        x: (touches[0].clientX + touches[1].clientX) / 2,
        y: (touches[0].clientY + touches[1].clientY) / 2,
    };
}

class MermaidPanZoomSettingTab extends PluginSettingTab {
    plugin: MermaidPanZoomPlugin;

    constructor(app: App, plugin: MermaidPanZoomPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Container height")
            .setDesc("Height of the diagram viewport in pixels")
            .addText((text) =>
                text
                    .setPlaceholder("500")
                    .setValue(String(this.plugin.settings.containerHeight))
                    .onChange(async (value) => {
                        const num = parseInt(value, 10);
                        if (!isNaN(num) && num > 100) {
                            this.plugin.settings.containerHeight = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Zoom speed")
            .setDesc("Mouse wheel zoom sensitivity (default 0.002)")
            .addText((text) =>
                text
                    .setPlaceholder("0.002")
                    .setValue(String(this.plugin.settings.zoomSpeed))
                    .onChange(async (value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num) && num > 0 && num < 0.1) {
                            this.plugin.settings.zoomSpeed = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Show controls")
            .setDesc("Display zoom buttons on diagram hover")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showControls).onChange(async (value) => {
                    this.plugin.settings.showControls = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName("Minimum zoom")
            .setDesc("Minimum zoom level (default 0.1 = 10%)")
            .addText((text) =>
                text
                    .setPlaceholder("0.1")
                    .setValue(String(this.plugin.settings.minZoom))
                    .onChange(async (value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num) && num > 0 && num < 1) {
                            this.plugin.settings.minZoom = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );

        new Setting(containerEl)
            .setName("Maximum zoom")
            .setDesc("Maximum zoom level (default 10 = 1000%)")
            .addText((text) =>
                text
                    .setPlaceholder("10")
                    .setValue(String(this.plugin.settings.maxZoom))
                    .onChange(async (value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num) && num > 1 && num <= 50) {
                            this.plugin.settings.maxZoom = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );
    }
}
