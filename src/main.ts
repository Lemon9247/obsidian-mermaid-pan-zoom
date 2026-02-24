import { Plugin, PluginSettingTab, App, Setting } from "obsidian";

// --- Settings ---

interface MermaidPanZoomSettings {
    containerHeight: number;
    minZoom: number;
    maxZoom: number;
    zoomSpeed: number;
    showControls: boolean;
    theme: string;
    customCSS: string;
}

const DEFAULT_SETTINGS: MermaidPanZoomSettings = {
    containerHeight: 500,
    minZoom: 0.1,
    maxZoom: 10,
    zoomSpeed: 0.002,
    showControls: true,
    theme: "obsidian",
    customCSS: "",
};

// --- Themes ---

// Each theme is a CSS string injected into the SVG <style> to override Mermaid's defaults.
// "obsidian" is special — it means "inherit the vault's theme" (no overrides).
const THEMES: Record<string, { label: string; css: string }> = {
    obsidian: {
        label: "Obsidian (match vault theme)",
        css: "", // No override — inherits from Obsidian's CSS context
    },
    clean: {
        label: "Clean",
        css: `
            .node rect, .node circle, .node ellipse, .node polygon, .node path,
            .label-container { fill: #ffffff !important; stroke: #6e7781 !important; }
            .nodeLabel, .label, .edgeLabel span { color: #1f2328 !important; }
            .edgePath path.path, .flowchart-link { stroke: #6e7781 !important; }
            .arrowheadPath, marker path { fill: #6e7781 !important; stroke: #6e7781 !important; }
            .cluster rect { fill: #f6f8fa !important; stroke: #d0d7de !important; }
            .cluster span, .cluster .nodeLabel { color: #656d76 !important; }
            .edgeLabel rect { fill: #f6f8fa !important; opacity: 1 !important; }
        `,
    },
    neutral: {
        label: "Neutral",
        css: `
            .node rect, .node circle, .node ellipse, .node polygon, .node path,
            .label-container { fill: #f0f0f0 !important; stroke: #999 !important; }
            .nodeLabel, .label, .edgeLabel span { color: #333 !important; }
            .edgePath path.path, .flowchart-link { stroke: #999 !important; }
            .arrowheadPath, marker path { fill: #999 !important; stroke: #999 !important; }
            .cluster rect { fill: #e8e8e8 !important; stroke: #bbb !important; }
            .cluster span, .cluster .nodeLabel { color: #666 !important; }
            .edgeLabel rect { fill: #e8e8e8 !important; opacity: 1 !important; }
        `,
    },
    ocean: {
        label: "Ocean",
        css: `
            .node rect, .node circle, .node ellipse, .node polygon, .node path,
            .label-container { fill: #0d1b2a !important; stroke: #48cae4 !important; }
            .nodeLabel, .label, .edgeLabel span { color: #caf0f8 !important; }
            .edgePath path.path, .flowchart-link { stroke: #48cae4 !important; }
            .arrowheadPath, marker path { fill: #48cae4 !important; stroke: #48cae4 !important; }
            .cluster rect { fill: #1b263b !important; stroke: #0077b6 !important; }
            .cluster span, .cluster .nodeLabel { color: #90e0ef !important; }
            .edgeLabel rect { fill: #1b263b !important; opacity: 1 !important; }
        `,
    },
    custom: {
        label: "Custom CSS",
        css: "", // Uses settings.customCSS
    },
};

// --- ViewBox state ---

interface ViewState {
    vbX: number;
    vbY: number;
    vbW: number;
    vbH: number;
    baseX: number;
    baseY: number;
    baseW: number;
    baseH: number;
    naturalW: number;
    naturalH: number;
}

// --- Icons ---

const ICONS = {
    zoomIn: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm9-3a1 1 0 0 0-2 0v2H5a1 1 0 0 0 0 2h2v2a1 1 0 0 0 2 0V9h2a1 1 0 0 0 0-2H9V5Z"/></svg>`,
    zoomOut: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2ZM0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm4 1a1 1 0 0 1 0-2h8a1 1 0 0 1 0 2H4Z"/></svg>`,
    fitView: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1 1h5v2H3.414L6 5.586 4.586 7 2 4.414V6H0V1h1Zm14 0h-5v2h2.586L10 5.586 11.414 7 14 4.414V6h2V1h-1ZM1 15h5v-2H3.414L6 10.414 4.586 9 2 11.586V10H0v5h1Zm14 0h-5v-2h2.586L10 10.414 11.414 9 14 11.586V10h2v5h-1Z"/></svg>`,
    reset: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.05 3.05a7 7 0 1 1 .02 9.88l1.43-1.43a5.001 5.001 0 1 0-.02-7.01L6 6H1V1l2.05 2.05Z"/></svg>`,
    popOut: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v9A1.5 1.5 0 0 0 3.5 14h9a1.5 1.5 0 0 0 1.5-1.5V10a1 1 0 0 0-2 0v2.5H3.5v-9H6a1 1 0 0 0 0-2H3.5ZM9 2a1 1 0 0 0 0 2h1.586L7.293 7.293a1 1 0 0 0 1.414 1.414L12 5.414V7a1 1 0 0 0 2 0V2H9Z"/></svg>`,
    close: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`,
};

// --- Reusable pan/zoom binding ---

interface PanZoomHandle {
    fitToView: () => void;
    resetView: () => void;
    zoomAtCenter: (factor: number) => void;
    destroy: () => void;
}

function bindPanZoom(
    viewport: HTMLElement,
    svg: SVGElement,
    naturalW: number,
    naturalH: number,
    settings: MermaidPanZoomSettings,
    onScaleChange?: (scale: number) => void
): PanZoomHandle {
    const computeBase = (): Pick<ViewState, "baseX" | "baseY" | "baseW" | "baseH"> => {
        const containerW = viewport.clientWidth || 1;
        const containerH = viewport.clientHeight || 1;
        const cAspect = containerW / containerH;
        const dAspect = naturalW / naturalH;

        let baseW: number, baseH: number;
        if (dAspect > cAspect) {
            baseW = naturalW;
            baseH = naturalW / cAspect;
        } else {
            baseH = naturalH;
            baseW = naturalH * cAspect;
        }

        const baseX = -(baseW - naturalW) / 2;
        const baseY = -(baseH - naturalH) / 2;
        return { baseX, baseY, baseW, baseH };
    };

    const base = computeBase();
    const state: ViewState = {
        vbX: base.baseX, vbY: base.baseY,
        vbW: base.baseW, vbH: base.baseH,
        ...base, naturalW, naturalH,
    };

    const applyViewBox = () => {
        svg.setAttribute("viewBox", `${state.vbX} ${state.vbY} ${state.vbW} ${state.vbH}`);
        onScaleChange?.(state.baseW / state.vbW);
    };

    const fitToView = () => {
        const base = computeBase();
        Object.assign(state, base);
        state.vbX = base.baseX;
        state.vbY = base.baseY;
        state.vbW = base.baseW;
        state.vbH = base.baseH;
        applyViewBox();
    };

    const resetView = () => {
        state.vbX = state.baseX;
        state.vbY = state.baseY;
        state.vbW = state.baseW;
        state.vbH = state.baseH;
        applyViewBox();
    };

    const zoomAtScreen = (screenX: number, screenY: number, factor: number) => {
        const currentScale = state.baseW / state.vbW;
        const newScale = clamp(currentScale * factor, settings.minZoom, settings.maxZoom);
        if (newScale === currentScale) return;

        const rect = viewport.getBoundingClientRect();
        const fracX = (screenX - rect.left) / rect.width;
        const fracY = (screenY - rect.top) / rect.height;

        const svgX = state.vbX + fracX * state.vbW;
        const svgY = state.vbY + fracY * state.vbH;

        state.vbW = state.baseW / newScale;
        state.vbH = state.baseH / newScale;
        state.vbX = svgX - fracX * state.vbW;
        state.vbY = svgY - fracY * state.vbH;

        applyViewBox();
    };

    const zoomAtCenter = (factor: number) => {
        const rect = viewport.getBoundingClientRect();
        zoomAtScreen(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    };

    // Mouse wheel zoom
    const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        zoomAtScreen(e.clientX, e.clientY, Math.exp(-e.deltaY * settings.zoomSpeed));
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });

    // Mouse drag pan
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0, vbStartX = 0, vbStartY = 0;

    const onMouseDown = (e: MouseEvent) => {
        if (e.button !== 0) return;
        isDragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        vbStartX = state.vbX;
        vbStartY = state.vbY;
        viewport.classList.add("mpz-grabbing");
        e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
        if (!isDragging) return;
        const rect = viewport.getBoundingClientRect();
        state.vbX = vbStartX - ((e.clientX - dragStartX) / rect.width) * state.vbW;
        state.vbY = vbStartY - ((e.clientY - dragStartY) / rect.height) * state.vbH;
        applyViewBox();
    };

    const onMouseUp = () => {
        if (isDragging) {
            isDragging = false;
            viewport.classList.remove("mpz-grabbing");
        }
    };

    viewport.addEventListener("mousedown", onMouseDown);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    // Touch
    let lastTouchDist = 0;
    let lastTouchCenter = { x: 0, y: 0 };
    let isTouchPanning = false;
    let touchVbStartX = 0, touchVbStartY = 0;
    let touchDragStartX = 0, touchDragStartY = 0;

    const onTouchStart = (e: TouchEvent) => {
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
    };

    const onTouchMove = (e: TouchEvent) => {
        const rect = viewport.getBoundingClientRect();
        if (e.touches.length === 2) {
            e.preventDefault();
            const dist = getTouchDistance(e.touches);
            const center = getTouchCenter(e.touches);
            zoomAtScreen(center.x, center.y, dist / lastTouchDist);
            state.vbX -= ((center.x - lastTouchCenter.x) / rect.width) * state.vbW;
            state.vbY -= ((center.y - lastTouchCenter.y) / rect.height) * state.vbH;
            applyViewBox();
            lastTouchDist = dist;
            lastTouchCenter = center;
        } else if (e.touches.length === 1 && isTouchPanning) {
            e.preventDefault();
            state.vbX = touchVbStartX - ((e.touches[0].clientX - touchDragStartX) / rect.width) * state.vbW;
            state.vbY = touchVbStartY - ((e.touches[0].clientY - touchDragStartY) / rect.height) * state.vbH;
            applyViewBox();
        }
    };

    const onTouchEnd = () => { isTouchPanning = false; lastTouchDist = 0; };

    viewport.addEventListener("touchstart", onTouchStart, { passive: false });
    viewport.addEventListener("touchmove", onTouchMove, { passive: false });
    viewport.addEventListener("touchend", onTouchEnd);

    // Double-click to fit
    const onDblClick = (e: MouseEvent) => { e.preventDefault(); fitToView(); };
    viewport.addEventListener("dblclick", onDblClick);

    const destroy = () => {
        viewport.removeEventListener("wheel", onWheel);
        viewport.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        viewport.removeEventListener("touchstart", onTouchStart);
        viewport.removeEventListener("touchmove", onTouchMove);
        viewport.removeEventListener("touchend", onTouchEnd);
        viewport.removeEventListener("dblclick", onDblClick);
    };

    return { fitToView, resetView, zoomAtCenter, destroy };
}

// --- Controls builder ---

function buildControls(
    handle: PanZoomHandle,
    extra?: { icon: string; title: string; onClick: () => void }[]
): { el: HTMLElement; updateLabel: (scale: number) => void } {
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

    controls.appendChild(makeBtn(ICONS.zoomIn, "Zoom in", () => handle.zoomAtCenter(1.3)));
    controls.appendChild(makeBtn(ICONS.zoomOut, "Zoom out", () => handle.zoomAtCenter(1 / 1.3)));
    controls.appendChild(makeBtn(ICONS.fitView, "Fit to view", () => handle.fitToView()));
    controls.appendChild(makeBtn(ICONS.reset, "Reset (100%)", () => handle.resetView()));

    if (extra) {
        for (const item of extra) {
            controls.appendChild(makeBtn(item.icon, item.title, item.onClick));
        }
    }

    const zoomLabel = document.createElement("span");
    zoomLabel.className = "mpz-zoom-label";
    zoomLabel.textContent = "100%";
    controls.appendChild(zoomLabel);

    return {
        el: controls,
        updateLabel: (scale: number) => {
            zoomLabel.textContent = `${Math.round(scale * 100)}%`;
        },
    };
}

// --- Theme injection ---

function getThemeCSS(settings: MermaidPanZoomSettings): string {
    if (settings.theme === "custom") return settings.customCSS;
    return THEMES[settings.theme]?.css || "";
}

/**
 * Inject theme CSS into an SVG element. Replaces any previous injection.
 * For "obsidian" theme, no CSS is injected — the SVG inherits from context.
 */
function applyThemeToSvg(svg: SVGElement, settings: MermaidPanZoomSettings) {
    // Remove previous injection
    const existing = svg.querySelector("style[data-mpz-theme]");
    if (existing) existing.remove();

    const css = getThemeCSS(settings);
    if (!css) return;

    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.setAttribute("data-mpz-theme", "true");
    styleEl.textContent = css;
    // Prepend so it can be overridden by Mermaid's own styles if needed,
    // but our !important declarations take priority
    svg.prepend(styleEl);
}

// --- Plugin ---

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
                if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
                this.debounceTimer = window.setTimeout(() => {
                    this.processPending();
                    this.debounceTimer = null;
                }, 150);
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });
        this.register(() => observer.disconnect());

        setTimeout(() => {
            const divs = document.querySelectorAll<HTMLElement>("div.mermaid");
            for (const div of Array.from(divs)) {
                if (this.processedDivs.has(div)) continue;
                const svg = div.querySelector("svg");
                if (svg && svg.childElementCount > 0) this.pendingProcess.add(div);
            }
            if (this.pendingProcess.size > 0) this.processPending();
        }, 500);
    }

    private processPending() {
        for (const div of this.pendingProcess) {
            if (this.processedDivs.has(div) || !div.isConnected) continue;
            const svg = div.querySelector("svg");
            if (!svg || svg.childElementCount === 0) continue;
            this.processedDivs.add(div);
            this.wrapWithPanZoom(div, svg);
        }
        this.pendingProcess.clear();
    }

    private prepareSvg(svg: SVGElement): { naturalW: number; naturalH: number } | null {
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
        if (!origVB) return null;

        const [, , naturalW, naturalH] = origVB.split(/[\s,]+/).map(Number);
        if (!naturalW || !naturalH) return null;

        svg.removeAttribute("width");
        svg.removeAttribute("height");
        svg.removeAttribute("preserveAspectRatio");
        svg.style.width = "100%";
        svg.style.height = "100%";

        return { naturalW, naturalH };
    }

    private wrapWithPanZoom(mermaidDiv: HTMLElement, svg: SVGElement) {
        const settings = this.settings;
        const dims = this.prepareSvg(svg);
        if (!dims) return;

        // Apply theme to inline view (non-obsidian themes only)
        applyThemeToSvg(svg, settings);

        const wrapper = document.createElement("div");
        wrapper.className = "mpz-wrapper";

        const viewport = document.createElement("div");
        viewport.className = "mpz-viewport";
        viewport.style.height = `${settings.containerHeight}px`;

        mermaidDiv.parentNode!.insertBefore(wrapper, mermaidDiv);
        viewport.appendChild(mermaidDiv);
        wrapper.appendChild(viewport);
        mermaidDiv.classList.add("mpz-content");
        mermaidDiv.style.overflow = "visible";

        const origViewBox = svg.getAttribute("viewBox") || "";

        const handle = bindPanZoom(viewport, svg, dims.naturalW, dims.naturalH, settings, (scale) => {
            ctrl.updateLabel(scale);
        });
        this.register(() => handle.destroy());

        const ctrl = buildControls(handle, [
            {
                icon: ICONS.popOut,
                title: "Pop out",
                onClick: () => this.openModal(svg, origViewBox, dims.naturalW, dims.naturalH),
            },
        ]);
        if (settings.showControls) wrapper.appendChild(ctrl.el);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => handle.fitToView());
        });
    }

    private openModal(sourceSvg: SVGElement, origViewBox: string, naturalW: number, naturalH: number) {
        const settings = this.settings;

        const overlay = document.createElement("div");
        overlay.className = "mpz-modal-overlay";

        const modal = document.createElement("div");
        modal.className = "mpz-modal";

        const modalViewport = document.createElement("div");
        modalViewport.className = "mpz-modal-viewport";

        // Wrap clone in a .mermaid div so Obsidian's theme CSS applies
        const mermaidContext = document.createElement("div");
        mermaidContext.className = "mermaid mpz-modal-content";

        const svgClone = sourceSvg.cloneNode(true) as SVGElement;
        svgClone.setAttribute("viewBox", origViewBox);
        svgClone.removeAttribute("width");
        svgClone.removeAttribute("height");
        svgClone.removeAttribute("preserveAspectRatio");
        svgClone.style.width = "100%";
        svgClone.style.height = "100%";

        // Apply theme to the clone
        applyThemeToSvg(svgClone, settings);

        mermaidContext.appendChild(svgClone);
        modalViewport.appendChild(mermaidContext);
        modal.appendChild(modalViewport);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const handle = bindPanZoom(modalViewport, svgClone, naturalW, naturalH, settings, (scale) => {
            ctrl.updateLabel(scale);
        });

        const closeModal = () => {
            handle.destroy();
            overlay.remove();
            document.removeEventListener("keydown", onKey);
        };

        const ctrl = buildControls(handle, [
            { icon: ICONS.close, title: "Close (Esc)", onClick: closeModal },
        ]);
        ctrl.el.classList.add("mpz-controls-visible");
        modal.appendChild(ctrl.el);

        overlay.addEventListener("mousedown", (e) => {
            if (e.target === overlay) closeModal();
        });

        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") closeModal();
        };
        document.addEventListener("keydown", onKey);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => handle.fitToView());
        });
    }
}

// --- Utility ---

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

// --- Settings Tab ---

class MermaidPanZoomSettingTab extends PluginSettingTab {
    plugin: MermaidPanZoomPlugin;

    constructor(app: App, plugin: MermaidPanZoomPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h3", { text: "Viewport" });

        new Setting(containerEl)
            .setName("Container height")
            .setDesc("Height of the diagram viewport in pixels")
            .addText((text) =>
                text.setPlaceholder("500")
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
            .setName("Show controls")
            .setDesc("Display zoom buttons on diagram hover")
            .addToggle((toggle) =>
                toggle.setValue(this.plugin.settings.showControls)
                    .onChange(async (value) => {
                        this.plugin.settings.showControls = value;
                        await this.plugin.saveSettings();
                    })
            );

        containerEl.createEl("h3", { text: "Zoom" });

        new Setting(containerEl)
            .setName("Zoom speed")
            .setDesc("Mouse wheel zoom sensitivity")
            .addText((text) =>
                text.setPlaceholder("0.002")
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
            .setName("Minimum zoom")
            .setDesc("Lower zoom bound (0.1 = 10%)")
            .addText((text) =>
                text.setPlaceholder("0.1")
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
            .setDesc("Upper zoom bound (10 = 1000%)")
            .addText((text) =>
                text.setPlaceholder("10")
                    .setValue(String(this.plugin.settings.maxZoom))
                    .onChange(async (value) => {
                        const num = parseFloat(value);
                        if (!isNaN(num) && num > 1 && num <= 50) {
                            this.plugin.settings.maxZoom = num;
                            await this.plugin.saveSettings();
                        }
                    })
            );

        containerEl.createEl("h3", { text: "Theme" });

        containerEl.createEl("p", {
            text: 'Controls the color scheme of Mermaid diagrams. "Obsidian" inherits your vault\'s theme. Other presets override Mermaid\'s default colors. "Custom CSS" lets you write your own.',
            cls: "setting-item-description",
        });

        new Setting(containerEl)
            .setName("Diagram theme")
            .addDropdown((dropdown) => {
                for (const [key, theme] of Object.entries(THEMES)) {
                    dropdown.addOption(key, theme.label);
                }
                dropdown.setValue(this.plugin.settings.theme);
                dropdown.onChange(async (value) => {
                    this.plugin.settings.theme = value;
                    await this.plugin.saveSettings();
                    // Re-render to show/hide custom CSS field
                    this.display();
                });
            });

        if (this.plugin.settings.theme === "custom") {
            const customSetting = new Setting(containerEl)
                .setName("Custom CSS")
                .setDesc("CSS to inject into Mermaid SVGs. Target Mermaid classes like .node rect, .edgeLabel, .cluster rect, etc. Use !important to override embedded styles.");

            const textArea = document.createElement("textarea");
            textArea.className = "mpz-custom-css-input";
            textArea.placeholder = `.node rect { fill: #1a1a2e !important; stroke: #e94560 !important; }
.nodeLabel { color: #eee !important; }
.edgePath path { stroke: #e94560 !important; }
.cluster rect { fill: #16213e !important; stroke: #0f3460 !important; }`;
            textArea.value = this.plugin.settings.customCSS;
            textArea.rows = 12;
            textArea.spellcheck = false;

            textArea.addEventListener("change", async () => {
                this.plugin.settings.customCSS = textArea.value;
                await this.plugin.saveSettings();
            });

            customSetting.controlEl.appendChild(textArea);
        }

        // Theme preview hint
        containerEl.createEl("p", {
            text: "Note: theme changes apply to newly rendered diagrams. Switch away from the note and back, or reload Obsidian to see changes on existing diagrams.",
            cls: "setting-item-description mpz-theme-hint",
        });
    }
}
