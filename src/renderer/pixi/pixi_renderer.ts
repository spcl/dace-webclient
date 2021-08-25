// Copyright 2019-2021 ETH Zurich and the DaCe authors. All rights reserved.

import { SDFGData } from '../../utils/sdfg/types';
import * as PIXI from 'pixi.js';
import { CompleteLayout, EdgeLayoutElement, LayoutElement } from './layouting/layout';
import { getAllDisplayObjects, LayoutElementDisplayState, RenderedLayoutElement, renderLayoutElement } from './layouting/render_layout_element';
import { RenderLayouter } from './layouting/layouters/layouter';
import { ExampleLayouter } from './layouting/layouters/example_layouter';
import { DummyLayouter } from './layouting/layouters/dummy_layouter';
import { ComplexLayouter } from './layouting/layouters/complex_layouter/complex_layouter';
import SugiyamaLayouter from '../../layouting/layouter/sugiyamaLayouter';
import LLayouter from '../../layouting/layouter/layouter';
import DagreLayouter from '../../layouting/layouter/dagreLayouter';
import MagneticSpringLayouter from '../../layouting/layouter/magneticSpringLayouter';
import { stringToColor } from '../../utils/colors';
import { createSpinner } from '../../utils/loading_spinner';
import { createToolbar } from './toolbar';
import { SymbolResolver } from '../../utils/symbol_resolver';
import { arrayEquals, setEquals } from '../../utils/utils';
import RenderGraph from '../../layouting/renderGraph/renderGraph';
// eslint-disable-next-line camelcase
import { traverse_sdfg } from '../../utils/sdfg/traversal';
import { pixiObjectToPdf } from '../../utils/pdf';
import { htmlSanitize } from '../../utils/sanitization';

const DETAILED_MODE_MAX_ELEMENTS = 500;

const ANIMATION_DURATION = 1000;
const ANIMATION_FUNCTION = (t: number) => 1 - Math.pow(1 - t, 3);  // cubic ease out

const FAR_ELEMENTS_SCALE_THRESHOLD = 0.6;

export const DefaultLayouters = {
    sugiyama: new ComplexLayouter(new SugiyamaLayouter({ shuffles: 0, shuffleGlobal: false, optimizeAngles: false, bundle: false })),
    dagre: new ComplexLayouter(new DagreLayouter()),
    dummy: new DummyLayouter(),
    example: new ExampleLayouter(),
    magneticSpring: new ComplexLayouter(new MagneticSpringLayouter()),
};

const mouseEventTypes = new Set([
    'mousedown',
    'mousemove',
    'mouseup',
    /*'touchstart',
    'touchmove',
    'touchend',*/
    'wheel',
    'click',
    'dblclick',
    'contextmenu',
] as const);


/**
 * A renderer implementation using PixiJS.
 */
export class PixiRenderer {
    /* # CONTAINER LAYOUT
     * 
     * The container layout is:
     * 
     * ```
     * - `app.stage`
     *   - `viewport` (scaled & positioned)
     *     - `pixiContainer`
     *       - `<...primary RenderedLayoutElements...>` (positioned)
     *       - `<...transient RenderedLayoutElements...>` (positioned)
     *   - `minimap.container` (positioned)
     *     - `minimap.elements` (scaled)
     *       - `minimap.focus` (positioned)
     *       - `<...minimap RenderedLayoutElements...>` (positioned)
     *     - `minimap.minimapOutline`
     *     - `minimap.focusOutline` (positioned)
     *   - `selectionRect`
     * ```
     * 
     * Containers that aren't positioned have `x = y = 0`; containers that aren't
     * scaled have `scale.x = scale.y = 1`. The implementation will break if you
     * try to position/scale a container that is not marked as such (eg. by setting
     * `pixiContainer.x/y`). However, you are free to add new containers as children
     * of other containers.
     * 
     * There is a distinction between primary RenderedLayoutElements and transient
     * RenderedLayoutElements. Given a layout element, there is exactly one primary
     * RenderedLayoutElement for it. However, each layout element may have any number
     * of transient RenderedLayoutElements (possibly zero).
     * 
     * Notably, while primary RenderedLayoutElements are created with the first render
     * frame, transient RenderedLayoutElements can be created on-the-fly. This makes
     * them useful for selection/hovering/highlighting (which is currently the only
     * place where we create them); a vast majority of nodes in a large graph will
     * never be hovered over.
     * 
-----------------------------------------------------------------------------------------
     * # SDFG -> your screen
     * 
     * Below is a high-level overview of how PixiRenderer processes the SDFG input. In
     * square brackets are variable names that may be used for objects of that type.
     * 
     * ```
     * SDFG input [sdfg, sdfgData, ...]: Raw SDFG POJO parsed from the .sdfg file.
     *     |
     *     | relayoutSDFG using an LLayouter (from layouter_dir)
     *     V
     * RenderGraph [renderData, getRenderGraph, node, ...]: A graph with SDFGElement nodes
     *                                                      and position/size information.
     *     |
     *     | ComplexLayouter
     *     V
     * LayoutElement[] [el, element, ...]: A flat strongly typed list with all objects and
     *                                     how to render them.
     *     |
     *     | renderLayoutElement
     *     V
     * RenderedLayoutElement[] [rendered, ...]: Objects containing the actual PixiJS objects.
     *     |
     *     | PixiRenderer.prepareContainerForRender
     *     V
     * PIXI.DisplayObject [pixiContainer]: A container for all the PixiJS objects.
     *     |                                            |
     *     | PixiJS                                     | pixiObjectToPdf
     *     V                                            V
     * Whatever you see on the screen! :)            HTML5 Canvas [ctx, ...]
     *                                                  |
     *                                                  | canvas2pdf
     *                                                  V
     *                                               PDF file
     * ```
     */

    private renderGraph: RenderGraph | undefined;

    private readonly app: PIXI.Application;
    private readonly symbolResolver: SymbolResolver;

    private readonly viewport: PIXI.Container;
    private pixiContainer: PIXI.Container | undefined;
    private minimap: {
        container: PIXI.Container,
        elements: PIXI.Container,
        focus: PIXI.Graphics,
        focusOutline: PIXI.Graphics,
        minimapOutline: PIXI.Graphics,
        renderedElements: Map<LayoutElement, RenderedLayoutElement>,
    } | undefined;
    private selectionRect: PIXI.Graphics;

    private dragDetails: DragDetails | null = null;
    private nextClickIsDrag = false;

    private selection: ElementSelection = createEmptyElementSelection();

    private isAboutToRedraw: Promise<void> | false = false;
    private isCurrentlyRelayouting: Promise<void> | false = false;

    private shouldResize = false;
    private renderCache = {
        /** Local bounds of the container that contains all the elements */
        containerBounds: null as PIXI.Rectangle | null,
        /** Map containing all layout elements as keys, and the corresponding primary RLE as values */
        layoutElements: new Map<LayoutElement, RenderedLayoutElement>(),
        /** Contains all primary and transient display objects with the corresponding layout element */
        pixiObjects: new Map<PIXI.DisplayObject, LayoutElement>(),
        /** Contains all primary and transient RLEs */
        allRendered: new Set<RenderedLayoutElement>(),
        /** All layout elements grouped by their highlighting group (if they have one) */
        highlightingGroups: new Map<unknown, Set<LayoutElement>>(),
        /** The computed CSS style declaration of the renderer */
        compStyle: undefined as any as CSSStyleDeclaration,
    };

    private viewportAnimation: {
        startTime: number | 'now',
        duration: number,
        startViewport: [pos: StageCoordinates, scale: number],
        targetViewport: [pos: StageCoordinates, scale: number],
    } | null = null;

    private destructors: (() => void)[] = [];
    private settingsChangeListeners: ((settings: RendererSettings) => void)[] = [];

    private settings: RendererSettings = {
        inclusiveRanges: false,
        memoryVolumeOverlay: false,
        omitAccessNodes: false,
        moveMode: 'pan',
        runtimeMap: null,
    };

    private tooltipContainer: HTMLElement;
    private interactionInfoContainer: HTMLElement;

    /**
     * Creates a new PixiJS renderer.
     * 
     *
     * Note that this constructor does not accept raw renderers from src/layouting - instead, wrap those in a
     * {@link ComplexLayouter} first.
     * 
     * @param container The HTML element to create the canvas in. Should be positioned (so either
     * `position: relative` or `absolute`)
     */
    constructor(
        private readonly sdfg: SDFGData,
        private readonly container: HTMLElement,
        private readonly mouseHandler: MouseEventHandler | null = null,
        public readonly debugDraw = false,
        private readonly layouter: RenderLayouter = DefaultLayouters.sugiyama,
    ) {
        if (layouter instanceof LLayouter) {
            throw new Error('Layouter must be of type RenderLayouter (in src/renderer/pixi), not Layouter (in src/layouting)! Try wrapping the layouter in a ComplexLayouter');
        }

        // Initialize PixiJS
        this.app = new PIXI.Application({
            autoDensity: true,
            resolution: window.devicePixelRatio,
            resizeTo: this.container,
            backgroundAlpha: 0,
            autoStart: false,
            sharedTicker: false,
        });
        this.viewport = new PIXI.Container();
        this.app.stage.addChild(this.viewport);
        this.selectionRect = new PIXI.Graphics();
        this.app.stage.addChild(this.selectionRect);
        container.appendChild(this.app.view);
        container.appendChild(createToolbar(this));

        // Create tooltip container
        this.tooltipContainer = document.createElement('div');
        this.tooltipContainer.className = 'sdfvtooltip';
        this.container.appendChild(this.tooltipContainer);

        // Create interaction info container
        this.interactionInfoContainer = document.createElement('div');
        Object.assign(this.interactionInfoContainer.style, {
            position: 'absolute',
            bottom: '.5rem',
            left: '.5rem',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            borderRadius: '5px',
            padding: '.3rem',
            display: 'none',
            color: '#eeeeee',
        });
        this.container.appendChild(this.interactionInfoContainer);

        // Create symbol resolver
        this.symbolResolver = new SymbolResolver(sdfg);

        // Register event handlers
        this.registerHandlers();

        // Start initial layout
        (async () => {
            await this.resetLayoutAsync();
        })();
    }

    /**
     * Redraws now, not waiting for the next animation frame. Use redrawAsync() instead
     */
    private redrawNow(timestamp: number): void {
        if (this.isCurrentlyRelayouting) {
            // Try redrawing next frame
            this.redrawAsync();
            return;
        }

        if (this.shouldResize) {
            this.app.resize();
        }

        this.prepareViewportForRender(timestamp);
        this.prepareContainerForRender();
        this.prepareMinimapForRender();
        this.app.render();
    }

    private prepareViewportForRender(timestamp: number): void {
        if (this.viewportAnimation) {
            const anim = this.viewportAnimation;
            if (anim.startTime === 'now') {
                anim.startTime = timestamp;
            }
            const complete = Math.min(1, (timestamp - anim.startTime) / anim.duration);
            const r = ANIMATION_FUNCTION(complete);

            // Calculate interpolated viewport
            const as = anim.startViewport;
            const at = anim.targetViewport;
            this.viewport.x = as[0][0] * (1 - r) + at[0][0] * r;
            this.viewport.y = as[0][1] * (1 - r) + at[0][1] * r;
            this.viewport.scale.x = this.viewport.scale.y = as[1] * (1 - r) + at[1] * r;

            if (complete >= 1) {
                this.viewportAnimation = null;
            } else {
                this.redrawAsync();
            }
        }
    }

    private prepareContainerForRender() {
        const toHide = new Set<PIXI.DisplayObject>();

        // Update selected elements
        if (this.selection.hasChanged) {
            // Remove old selection objects
            for (const rendered of this.selection.selectionPixiObjects) {
                this.removeTransientRenderedLayoutElement(rendered);
            }

            // Show the Pixi objects that were hidden for the old selection
            for (const rendered of this.selection.hiddenPixiObjects) {
                getAllDisplayObjects(rendered).forEach(obj => obj.visible = true);
            }

            // Create a map containing all selected elements and their display attributes
            const selectedElements = new Map<LayoutElement, {
                isSelected: boolean,
                displayState: LayoutElementDisplayState,
            }>();
            for (const el of [...this.selection.selected, ...this.selection.hovered, ...this.selection.highlighted]) {
                selectedElements.set(el, {
                    isSelected: false,
                    displayState: 'normal',
                });
            }

            // Set display attributes
            this.selection.selected.forEach(el => selectedElements.get(el)!.isSelected = true);
            this.selection.highlighted.forEach(el => selectedElements.get(el)!.displayState = 'highlighted');
            this.selection.hovered.forEach(el => selectedElements.get(el)!.displayState = 'hover');

            // Create new Pixi objects
            const selectionPixiObjects = [];
            for (const [el, attrs] of selectedElements.entries()) {
                const rendered = renderLayoutElement(el, this.renderCache.compStyle, {
                    ...attrs,
                    detailMode: isDetailed(this.renderCache.layoutElements.size) ? 'detailed' : 'normal',
                });
                this.addTransientRenderedLayoutElement(rendered);
                selectionPixiObjects.push(rendered);
            }
            this.pixiContainer?.sortChildren();

            // Hide selected Pixi objects
            const hiddenPixiObjects = [];
            for (const el of selectedElements.keys()) {
                const rendered = this.renderCache.layoutElements.get(el)!;
                hiddenPixiObjects.push(rendered);
                getAllDisplayObjects(rendered).forEach(obj => toHide.add(obj));
            }

            // Update selection variable
            this.selection = {
                ...this.selection,
                hiddenPixiObjects,
                selectionPixiObjects,
                hasChanged: false,
            };
        }

        // Redraw selection rectangle
        if (this.dragDetails?.type === 'select') {
            const computedStyle = this.renderCache.compStyle;
            this.selectionRect.visible = true;
            this.selectionRect.clear();
            this.selectionRect.lineStyle(1, ...stringToColor(computedStyle.getPropertyValue('--selection-rect-color')));
            this.selectionRect.beginFill(...stringToColor(computedStyle.getPropertyValue('--selection-rect-fill')));
            this.selectionRect.drawRect(
                ...this.dragDetails.dragStart,
                this.dragDetails.lastTick[0] - this.dragDetails.dragStart[0],
                this.dragDetails.lastTick[1] - this.dragDetails.dragStart[1],
            );
        } else {
            this.selectionRect.visible = false;
        }

        // Update near/far elements
        const isFar = this.viewport.scale.x < FAR_ELEMENTS_SCALE_THRESHOLD;
        for (const rendered of this.renderCache.allRendered) {
            for (const obj of rendered.near) {
                if (toHide.has(obj)) continue;
                obj.visible = !isFar;
            }
            for (const obj of rendered.far) {
                if (toHide.has(obj)) continue;
                obj.visible = isFar;
            }
        }

        // Hide objects that should be hidden
        toHide.forEach(l => l.visible = false);
    }


    private prepareMinimapForRender() {
        const viewSize = this.getViewSize();
        const containerBounds = this.getContainerBounds();

        if (this.minimap) {
            const { container, elements, focus, focusOutline, minimapOutline } = this.minimap;
            const computedStyle = this.renderCache.compStyle;

            // Draw focus
            const unscaledFocusRect = [
                -this.viewport.x / this.viewport.scale.x,  // leftX
                -this.viewport.y / this.viewport.scale.y,  // topY
                viewSize[0] / this.viewport.scale.x,       // width
                viewSize[1] / this.viewport.scale.y,       // height
            ] as const;
            focus.clear();
            focus.beginFill(...stringToColor(computedStyle.getPropertyValue('--minimap-focus-fill')));
            focus.drawRect(...unscaledFocusRect);


            // getLocalBounds() is slow, so we manually compute the coordinates
            const elementsLocalBounds = [
                Math.min(containerBounds.left, unscaledFocusRect[0]),  // leftX
                Math.min(containerBounds.top, unscaledFocusRect[1]),  // topY
                Math.max(containerBounds.right, unscaledFocusRect[0] + unscaledFocusRect[2]),   // rightX
                Math.max(containerBounds.bottom, unscaledFocusRect[1] + unscaledFocusRect[3]),  // bottomY
            ] as const;

            // Rescale elements & focus (but not focus outline, which is in `container`, not `elements`)
            if (this.dragDetails?.type !== 'minimap') {  // don't rescale if we're currently dragging the minimap
                elements.scale.x = elements.scale.y = Math.min(
                    0.25,
                    0.15 * viewSize[0] / (elementsLocalBounds[2] - elementsLocalBounds[0]),
                    viewSize[1] / (elementsLocalBounds[3] - elementsLocalBounds[1]),
                );
            }

            // Draw focus outline (which we scale manually using the newly calculated scale to preserve stroke width)
            const scaledFocusRect = [
                unscaledFocusRect[0] * elements.scale.x,  // leftX
                unscaledFocusRect[1] * elements.scale.y,  // topY
                unscaledFocusRect[2] * elements.scale.x,  // width
                unscaledFocusRect[3] * elements.scale.y,  // height
            ] as const;
            focusOutline.clear();
            focusOutline.lineStyle(1, ...stringToColor(computedStyle.getPropertyValue('--minimap-focus-color')));
            focusOutline.drawRect(...scaledFocusRect);

            // getLocalBounds() is slow, so we manually compute the coordinates
            const localBounds = [
                elementsLocalBounds[0] * elements.scale.x,  // leftX
                elementsLocalBounds[1] * elements.scale.y,  // topY
                elementsLocalBounds[2] * elements.scale.x,  // rightX
                elementsLocalBounds[3] * elements.scale.y,  // bottomY
            ] as const;

            // Reposition container
            if (this.dragDetails?.type !== 'minimap') {  // don't reposition if we're currently dragging the minimap
                container.x = viewSize[0] - localBounds[2];
                container.y = -localBounds[1];
                container.hitArea = new PIXI.Rectangle(localBounds[0], localBounds[1], localBounds[2] - localBounds[0], localBounds[3] - localBounds[1]);
            }

            // Draw minimap outline
            minimapOutline.clear();
            minimapOutline.lineStyle(1, ...stringToColor(computedStyle.getPropertyValue('--minimap-outline-color')));
            minimapOutline.line.cap = PIXI.LINE_CAP.SQUARE;
            minimapOutline.moveTo(localBounds[0], -container.y);
            minimapOutline.lineTo(localBounds[0], localBounds[3]);
            minimapOutline.lineTo(viewSize[1] + container.x, localBounds[3]);
        }
    }

    /**
     * Marks the scene as dirty, scheduling a redraw with the next animation frame. Returns a Promise that resolves
     * after the redraw (but before the frame renders).
     */
    private async redrawAsync(): Promise<void> {
        await (this.isAboutToRedraw ||= new Promise<void>(resolve => requestAnimationFrame((time) => {
            this.isAboutToRedraw = false;
            this.redrawNow(time);
            resolve();
        })));
    }

    private async resetLayoutNow(): Promise<void> {
        const loadingSpinner = createSpinner();
        this.container.appendChild(loadingSpinner.element);

        try {
            loadingSpinner.setCaption('Layouting…');
            await skipFrame(); // Wait for the loading indicator to render
            const timeStart = performance.now();
            const layout = this.layouter.layout(this.sdfg, this.settings, this.symbolResolver);
            this.renderGraph = layout.graph;
            const layoutingTime = performance.now() - timeStart;

            // If layouting was fast, don't waste time rendering the loading indicator (saves ~30ms on 60Hz screens)
            const fasterThanFrames = layoutingTime <= 100;

            loadingSpinner.setCaption('Initializing stage…');
            if (!fasterThanFrames) await skipFrame();
            this.resetStage(layout);

            loadingSpinner.setCaption('Rendering…');
            if (!fasterThanFrames) await skipFrame();
            await this.redrawAsync();
        } finally {
            this.container.removeChild(loadingSpinner.element);
        }
    }

    /**
     * Initiate a complete relayout and reset the stage. This is a potentially very
     * slow operation
     */
    private async resetLayoutAsync(): Promise<void> {
        if (this.isCurrentlyRelayouting) {
            // If we're currently relayouting, wait for it to finish and then start over
            // as things might've changed between that function call and now
            await this.isCurrentlyRelayouting;
        }
        if (this.isCurrentlyRelayouting) {
            // If we're *still* relayouting, that means another layout request started
            // since this function was called. Someone else is doing the work for us,
            // so we can just wait for it to finish.
            await this.isCurrentlyRelayouting;
        } else {
            this.isCurrentlyRelayouting = this.resetLayoutNow();
            try {
                await this.isCurrentlyRelayouting;
            } finally {
                this.isCurrentlyRelayouting = false;
            }
        }
    }

    private addTransientRenderedLayoutElement(
        rendered: RenderedLayoutElement,
        context: Pick<PixiRenderer['renderCache'],
            | 'pixiObjects'
            | 'allRendered'
        > = this.renderCache,
    ): void {
        context.allRendered.add(rendered);
        const objs = getAllDisplayObjects(rendered);
        for (const obj of objs) {
            obj.interactive = true;
            context.pixiObjects.set(obj, rendered.layoutElement);
        }
        this.pixiContainer!.addChild(...objs);
    }

    private removeTransientRenderedLayoutElement(rendered: RenderedLayoutElement) {
        this.renderCache.allRendered.delete(rendered);
        const objs = getAllDisplayObjects(rendered);
        this.pixiContainer!.removeChild(...objs);
        for (const obj of objs) {
            this.renderCache.pixiObjects.delete(obj);
            obj.destroy(true);
        }
    }

    private updateLayoutElementAndRerenderPrimary(
        element: LayoutElement,
        context: Pick<PixiRenderer['renderCache'],
            | 'pixiObjects'
            | 'allRendered'
            | 'layoutElements'
            | 'highlightingGroups'
            | 'compStyle'
        > = this.renderCache,
        totalElements = context.layoutElements.size,
    ) {
        // Remove old element & invalidate selection
        const oldRendered = context.layoutElements.get(element);
        if (oldRendered) {
            this.removeTransientRenderedLayoutElement(oldRendered);
            this.selection = {
                ...this.selection,
                hasChanged: true,
            };
            if (this.minimap) {
                const minimapRendereds = this.minimap.renderedElements.get(element)!;
                const minimapObjs = [...minimapRendereds.always, ...minimapRendereds.near];
                this.minimap.elements.removeChild(...minimapObjs);
                minimapObjs.forEach(obj => obj.destroy(true));
            }
        }

        // Add new element
        const rendered = renderLayoutElement(
            element,
            context.compStyle,
            PixiRenderer.getLayoutElementRenderingSettings(totalElements),
        );
        this.addTransientRenderedLayoutElement(rendered, context);
        context.layoutElements.set(element, rendered);

        // Register highlighting group
        if (Reflect.has(element, 'highlightingGroup')) {
            const hlGroup = element.highlightingGroup;
            if (!context.highlightingGroups.has(hlGroup)) {
                context.highlightingGroups.set(hlGroup, new Set<LayoutElement>());
            }
            context.highlightingGroups.get(hlGroup)!.add(element);
        }

        // Update minimap
        if (this.minimap) {
            const minimapRendered = renderLayoutElement(element, context.compStyle, {
                displayState: 'normal',
                isSelected: false,
                detailMode: 'quick',
            });
            this.minimap!.elements.addChild(...minimapRendered.always, ...minimapRendered.near);
            this.minimap!.renderedElements.set(element, minimapRendered);
        }

        // Redraw
        this.renderCache.containerBounds = null;
        this.redrawAsync();
    }

    private static getLayoutElementRenderingSettings(totalElements: number) {
        return {
            displayState: 'normal',
            isSelected: false,
            detailMode: isDetailed(totalElements) ? 'detailed' : 'normal',
        } as const;
    }


    /**
 * Resets the current stage, causing a complete re-render. Don't call this directly, instead call `resetLayoutAsync`
 */
    private resetStage(layout: CompleteLayout) {
        const oldBounds = this.pixiContainer ? this.getContainerBounds() : null;

        // Reset scene
        if (this.pixiContainer) {
            this.viewport.removeChild(this.pixiContainer);
            this.pixiContainer.destroy(true);
        }
        if (this.minimap) {
            this.app.stage.removeChild(this.minimap.container);
            this.minimap.container.destroy(true);
        }

        // Reset selection
        this.selection = createEmptyElementSelection();

        // Set up Pixi Container
        this.pixiContainer = new PIXI.Container();
        this.viewport.addChild(this.pixiContainer);

        // Set up Minimap
        this.minimap = {
            container: new PIXI.Container(),
            elements: new PIXI.Container(),
            focus: new PIXI.Graphics(),
            focusOutline: new PIXI.Graphics(),
            minimapOutline: new PIXI.Graphics(),
            renderedElements: new Map<LayoutElement, RenderedLayoutElement>(),
        };
        this.minimap.container.alpha = 0.75;
        this.minimap.container.interactive = true;
        this.minimap.container.interactiveChildren = false;
        this.minimap.container.addChild(this.minimap.elements);
        this.minimap.container.addChild(this.minimap.focusOutline);
        this.minimap.container.addChild(this.minimap.minimapOutline);
        this.minimap.focus.zIndex = Number.MAX_SAFE_INTEGER;
        this.app.stage.addChild(this.minimap.container);

        // Add layout elements to container & minimap
        const compStyle = window.getComputedStyle(this.app.view);
        const layoutElements = new Map<LayoutElement, RenderedLayoutElement>();
        const pixiObjects = new Map<PIXI.DisplayObject, LayoutElement>();
        const allRendered = new Set<RenderedLayoutElement>();
        const highlightingGroups = new Map<unknown, Set<LayoutElement>>();
        for (const el of layout.elements) {
            if (layoutElements.has(el)) throw new Error('Duplicate layout element! (Layout elements must be unique)');

            this.updateLayoutElementAndRerenderPrimary(el, {
                layoutElements,
                pixiObjects,
                allRendered,
                highlightingGroups,
                compStyle,
            }, layout.elements.length);
        }
        this.minimap.elements.addChild(this.minimap.focus);
        this.pixiContainer.sortChildren();
        this.minimap.elements.sortChildren();

        // Reposition viewport
        const containerBounds = this.pixiContainer.getLocalBounds();
        this.viewport.x += (oldBounds?.left ?? 0) - containerBounds.left;
        this.viewport.y += (oldBounds?.top ?? 0) - containerBounds.top;

        // Update render cache
        this.renderCache = {
            containerBounds,
            layoutElements,
            pixiObjects,
            allRendered,
            compStyle,
            highlightingGroups
        };
    }

    private getContainerBounds() {
        return this.renderCache.containerBounds ??= this.pixiContainer!.getLocalBounds();
    }

    private getViewSize(): StageCoordinates {
        // TODO view.clientWidth is not optimal, are there edge cases where it fails?
        // we should get DOM viewport coordinates instead and then translate them to local stage coordinates (akin to getMousePosition(...))
        // view.width fails on retina displays
        return [this.app.view.clientWidth, this.app.view.clientHeight];
    }

    /**
     * Returns the mouse position local to the PixiJS stage.
     */
    private getMousePosition(event: MouseEvent | { clientX: number, clientY: number }): StageCoordinates {
        const int: PIXI.InteractionManager = this.app.renderer.plugins.interaction;
        const mousePos = new PIXI.Point();
        int.mapPositionToPoint(mousePos, event.clientX, event.clientY);
        return [mousePos.x, mousePos.y];
    }

    private getHitElement(event: MouseEvent): LayoutElement | undefined {
        const pos = this.getMousePosition(event);

        const int: PIXI.InteractionManager = this.app.renderer.plugins.interaction;
        const hitObj = int.hitTest(new PIXI.Point(...pos));
        const hitEl = hitObj && this.renderCache.pixiObjects.get(hitObj);

        return hitEl ?? undefined;
    }

    private registerHandlers() {
        // TODO: touch events

        // === Resizing ===
        const resizeObserver = new ResizeObserver(() => {
            this.shouldResize = true;
            this.redrawAsync();
        });
        this.destructors.push(() => resizeObserver.disconnect());  // prevent memory leaks
        resizeObserver.observe(this.container);


        // === Dragging ===
        this.app.view.addEventListener('mousedown', (event) => {
            this.nextClickIsDrag = false;
            if (event.button !== 0 && event.button !== 1) return;
            const dragStart = this.getMousePosition(event);
            const dragDetails = {
                dragStart,
                lastTick: dragStart,
            };
            const int: PIXI.InteractionManager = this.app.renderer.plugins.interaction;
            const isMinimapHit = this.minimap && int.hitTest(new PIXI.Point(...dragStart), this.minimap?.container);

            const dragType = event.button === 1 ? 'pan'
                : isMinimapHit ? 'minimap'
                    : this.getSettings().moveMode;
            switch (dragType) {
                case 'minimap': {
                    this.setMinimapFocus(dragStart);

                    this.dragDetails = {
                        type: 'minimap',
                        ...dragDetails
                    };
                    break;
                }
                case 'pan': {
                    this.dragDetails = {
                        type: 'viewport',
                        ...dragDetails
                    };
                    break;
                }
                case 'move': {
                    const specialKeyPressed = event.shiftKey || event.ctrlKey || event.metaKey;
                    const hitEl = this.getHitElement(event);
                    if (!hitEl) return;
                    const hitSelected = this.selection.selected.has(hitEl);
                    const selected = [...this.selection.selected];
                    const allSelectedForMove = specialKeyPressed
                        ? (hitSelected ? selected.filter(el => el !== hitEl) : [...selected, hitEl])
                        : (hitSelected ? [...selected] : [hitEl!]);
                    const selectedForMove = allSelectedForMove.filter(el => ['state', 'node'].includes(el.type));

                    if (selectedForMove.length === 0) {
                        const sel = allSelectedForMove.filter(el => el.type === 'edge') as EdgeLayoutElement[];
                        const controlPoints = sel.flatMap(
                            edge => edge.points.map((_, i) => [edge, i] as const).slice(1, -1)
                        );
                        this.dragDetails = {
                            type: 'move-edge-control-points',
                            controlPoints,
                            ...dragDetails
                        };
                    } else {
                        // Find elements, their child elements, and nearby edges
                        const elements = new Set<Exclude<LayoutElement, EdgeLayoutElement>>();
                        const edgeBeginnings: Set<EdgeLayoutElement> = new Set();
                        const edgeEnds: Set<EdgeLayoutElement> = new Set();
                        const stack = selectedForMove.map(el => el.renderData).filter(d => d);
                        while (stack.length > 0) {
                            const renderNode = stack.pop()!;
                            elements.add((renderNode as any).layoutElement);
                            if (renderNode.childGraph) stack.push(...renderNode.childGraph.nodes());
                            if (renderNode.inConnectors) stack.push(...renderNode.inConnectors);
                            if (renderNode.outConnectors) stack.push(...renderNode.outConnectors);

                            const graph: RenderGraph = (renderNode as any).graph;
                            if (renderNode.id !== undefined && graph) {
                                const inEdges = graph.inEdges(renderNode.id);
                                const outEdges = graph.outEdges(renderNode.id);
                                outEdges.map(edge => (edge as any).layoutElement).forEach(el => edgeBeginnings.add(el));
                                inEdges.map(edge => (edge as any).layoutElement).forEach(el => edgeEnds.add(el));
                            }
                        }

                        this.dragDetails = {
                            type: 'move-objects',
                            elements,
                            edgeBeginnings,
                            edgeEnds,
                            ...dragDetails
                        };
                    }
                    break;
                }
                case 'select': {
                    this.dragDetails = {
                        type: 'select',
                        ...dragDetails
                    };
                    break;
                }
                default: {
                    throw new Error(`Unknown drag type during mousedown! ${dragType}`);
                }
            }

            event.preventDefault();
            event.stopPropagation();
        });

        window.addEventListener('mousemove', (event) => {
            this.nextClickIsDrag = true;
            if (!this.dragDetails) return;

            const thisTick = this.getMousePosition(event);
            const lastTick = this.dragDetails.lastTick;
            const diff = [thisTick[0] - lastTick[0], thisTick[1] - lastTick[1]] as const;

            switch (this.dragDetails.type) {
                case 'viewport': {
                    this.transformViewport(diff);
                    break;
                }
                case 'minimap': {
                    this.setMinimapFocus(thisTick);
                    break;
                }
                case 'move-objects': {
                    const { elements, edgeBeginnings, edgeEnds } = this.dragDetails;

                    // Move beginning edge control points
                    for (const edge of edgeBeginnings) {
                        for (let i = 0; i < edge.points.length; i++) {
                            edge.points[i][0] += (1 - i / (edge.points.length - 1)) * diff[0] / this.viewport.scale.x;
                            edge.points[i][1] += (1 - i / (edge.points.length - 1)) * diff[1] / this.viewport.scale.x;
                        }
                        this.updateLayoutElementAndRerenderPrimary(edge);
                    }

                    // Move ending edge control points
                    for (const edge of edgeEnds) {
                        for (let i = 0; i < edge.points.length; i++) {
                            edge.points[i][0] += (i / (edge.points.length - 1)) * diff[0] / this.viewport.scale.x;
                            edge.points[i][1] += (i / (edge.points.length - 1)) * diff[1] / this.viewport.scale.x;
                        }
                        this.updateLayoutElementAndRerenderPrimary(edge);
                    }

                    // Move non-edge elements
                    for (const element of elements) {
                        element.x += diff[0] / this.viewport.scale.x;
                        element.y += diff[1] / this.viewport.scale.y;
                        this.updateLayoutElementAndRerenderPrimary(element);
                    }
                    break;
                }
                case 'move-edge-control-points': {
                    const { controlPoints } = this.dragDetails;
                    for (const [edge, i] of controlPoints) {
                        edge.points[i][0] += diff[0] / this.viewport.scale.x;
                        edge.points[i][1] += diff[1] / this.viewport.scale.x;
                        this.updateLayoutElementAndRerenderPrimary(edge);
                    }
                    break;
                }
                case 'select': {
                    this.redrawAsync();
                    break;
                }
                default: {
                    throw new Error(`Unknown drag type during mousemove! ${(this.dragDetails as any).type}`);
                }
            }

            this.dragDetails.lastTick = thisTick;
        });

        window.addEventListener('mouseup', (event) => {
            switch (this.dragDetails?.type) {
                case 'minimap': {
                    // Minimap doesn't scale while mouse is held, so redraw one more time
                    this.redrawAsync();
                    break;
                }
                case 'select': {
                    const x1 = this.dragDetails.dragStart[0];
                    const y1 = this.dragDetails.dragStart[1];
                    const x2 = this.dragDetails.lastTick[0];
                    const y2 = this.dragDetails.lastTick[1];
                    const rect = new PIXI.Rectangle(
                        Math.min(x1, x2),
                        Math.min(y1, y2),
                        Math.abs(x1 - x2),
                        Math.abs(y1 - y2),
                    );

                    const selection = new Set<LayoutElement>();
                    for (const [element, rendered] of this.renderCache.layoutElements) {
                        const hb = rendered.hitbox.clone();
                        hb.x = (hb.x) * this.viewport.scale.x + this.viewport.x;
                        hb.y = (hb.y) * this.viewport.scale.y + this.viewport.y;
                        hb.width *= this.viewport.scale.x;
                        hb.height *= this.viewport.scale.y;
                        if (
                            hb.left >= rect.left
                            && hb.top >= rect.top
                            && hb.right <= rect.right
                            && hb.bottom <= rect.bottom
                        ) {
                            selection.add(element);
                        }
                    }

                    if (event.shiftKey) {
                        this.setSelected([...this.selection.selected, ...selection]);
                    } else if (event.ctrlKey || event.metaKey) {
                        this.setSelected([...this.selection.selected].filter(el => !selection.has(el)));
                    } else {
                        this.setSelected(selection);
                    }

                    this.redrawAsync();
                    break;
                }
                default: {
                    // Do nothing!
                    break;
                }
            }
            this.dragDetails = null;
        });


        // === Zooming ===
        // We need to handle wheel events occuring in the canvas, and also events occuring outside the canvas while
        // the mouse is dragging
        const handleWheel = (event: WheelEvent) => {
            const sc = 0.999 ** event.deltaY;
            this.transformViewport([0, 0], sc, this.getMousePosition(event));
            event.preventDefault();
            event.stopPropagation();
        };
        this.app.view.addEventListener('wheel', handleWheel);
        window.addEventListener('wheel', (e) => this.dragDetails && handleWheel(e));

        // === Set tooltip position ===
        this.app.view.addEventListener('mousemove', (event) => {
            if (this.dragDetails) return;

            const br = this.app.view.getBoundingClientRect();

            this.tooltipContainer.style.top = (event.clientY - br.y) + 'px';
            this.tooltipContainer.style.left = (event.clientX - br.x + 20) + 'px';
        });

        // === Hovering ===
        const setHovered = (elements: LayoutElement[]) => {
            const withTooltip = elements.filter(el => el.tooltip);
            switch (withTooltip.length) {
                case 0: {
                    this.tooltipContainer.style.display = 'none';
                    break;
                }
                case 1: {
                    const el = withTooltip[0];
                    this.tooltipContainer.className = 'sdfvtooltip';
                    this.tooltipContainer.style.display = 'block';
                    this.tooltipContainer.innerHTML = el.tooltip!.html;
                    this.tooltipContainer.classList.add(...{
                        normal: [],
                        interstate: ['sdfvtooltip--interstate-edge'],
                        connector: ['sdfvtooltip--connector'],
                    }[el.tooltip!.style]);
                    break;
                }
                default: {
                    this.tooltipContainer.className = 'sdfvtooltip';
                    this.tooltipContainer.style.display = 'block';
                    this.tooltipContainer.innerText = '[Multiple tooltips]';
                    break;
                }
            }

            if (!arrayEquals(elements, [...this.selection.hovered])) {
                const highlighted = new Set(elements
                    .filter(el => Reflect.has(el, 'highlightingGroup'))
                    .map(el => el.highlightingGroup)
                    .flatMap(g => [...this.renderCache.highlightingGroups.get(g)!]));

                this.selection = {
                    ...this.selection,
                    highlighted,
                    hovered: new Set(elements),
                    hasChanged: true,
                };
                this.redrawAsync();
            }
        };

        this.app.view.addEventListener('mousemove', (event) => {
            if (this.dragDetails) return;

            const hitEl = this.getHitElement(event);
            setHovered(hitEl ? [hitEl] : []);
        });

        this.app.view.addEventListener('mouseleave', () => {
            if (this.dragDetails) return;

            setHovered([]);
        });

        // === Selection ===
        this.app.view.addEventListener('click', (event) => {
            if (this.nextClickIsDrag) return;

            const hitEl = this.getHitElement(event);
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey) {
                this.setSelected(hitEl ? [hitEl] : []);
            } else if (hitEl) {
                const selected = this.selection.selected;
                this.setSelected(
                    selected.has(hitEl) ? [...selected].filter(el => el !== hitEl) : [...selected, hitEl]
                );
            }
        });

        // === Toggle collapse & expand ===
        this.app.view.addEventListener('dblclick', (event) => {
            if (this.nextClickIsDrag) return;

            const hitEl = this.getHitElement(event);
            if (hitEl) this.toggleCollapsed(hitEl);
        });


        // === External mouse events ===
        for (const type of mouseEventTypes) {
            this.app.view.addEventListener(type, (event) => {
                if (!this.mouseHandler) return;

                const mousePosition = this.getMousePosition(event);
                this.mouseHandler(
                    type,
                    event,
                    { x: mousePosition[0], y: mousePosition[1] },
                    this,
                    [...this.selection.selected].map(el => el.renderData).filter(x => x !== undefined),
                    this.nextClickIsDrag,
                );
                if (this.nextClickIsDrag) return;
            });
        }

    }

    private setMinimapFocus(posCenter: StageCoordinates) {
        const viewSize = this.getViewSize();

        if (!this.minimap) return;
        const mapFocusCoords = [  // in local coordinates
            (posCenter[0] - this.minimap.container.x) / this.minimap.elements.scale.x,
            (posCenter[1] - this.minimap.container.y) / this.minimap.elements.scale.y,
        ];
        const topLeft = [
            -(mapFocusCoords[0] * this.viewport.scale.x - viewSize[0] / 2),
            -(mapFocusCoords[1] * this.viewport.scale.y - viewSize[1] / 2),
        ] as const;
        this.setViewport(topLeft);
    }

    private transformViewport(pos: StageCoordinates, zoom = 1, zoomCenter: StageCoordinates | null = null, duration: number | null = null) {
        if (zoom !== 1 && zoomCenter) {
            pos = [
                pos[0] + zoomCenter[0] - (zoomCenter[0] - this.viewport.x) * zoom,
                pos[1] + zoomCenter[1] - (zoomCenter[1] - this.viewport.y) * zoom,
            ];
        } else {
            pos = [this.viewport.x + pos[0], this.viewport.y + pos[1]];
        }
        this.setViewport(pos, this.viewport.scale.x * zoom, duration);
    }

    private setViewport(pos: StageCoordinates | null, scale: number | null = null, duration: number | null = null) {
        if (duration === null) {
            // manually set if duration is not given so properties are immediately readable (before the next rerender)
            if (pos) [this.viewport.x, this.viewport.y] = pos;
            if (scale !== null) this.viewport.scale.x = this.viewport.scale.y = scale;
        } else {
            this.viewportAnimation = {
                startTime: 'now',
                duration,
                startViewport: [[this.viewport.x, this.viewport.y], this.viewport.scale.x],
                targetViewport: [pos ?? [this.viewport.x, this.viewport.y], scale ?? this.viewport.scale.x],
            };
        }
        this.redrawAsync();
    }

    private setViewportRect(rect: PIXI.Rectangle, duration: number | null) {
        const viewSize = this.getViewSize();
        const scale = Math.min(viewSize[0] / rect.width, viewSize[1] / rect.height);
        const posX = rect.x * scale + (rect.width * scale - viewSize[0]) / 2;
        const posY = rect.y * scale + (rect.height * scale - viewSize[1]) / 2;
        this.setViewport(
            [-posX, -posY],
            scale,
            duration,
        );
    }

    destroy(): void {
        this.app.destroy(true, true);
        this.destructors.forEach(d => d());
    }

    getSettings(): RendererSettings {
        return {
            ...this.settings,
        };
    }

    updateSettings(settings: Partial<RendererSettings>): void {
        this.settings = {
            ...this.settings,
            ...settings,
        };

        // Check whether the updated settings require a full relayout
        const noRelayout = new Set<keyof RendererSettings>(['moveMode']);
        if (Object.keys(settings).every((k: any) => noRelayout.has(k))) {
            this.redrawAsync();
        } else {
            this.relayout();
        }

        // Update interaction info container
        const interactionText = {
            pan: '',
            move: htmlSanitize`Middle Mouse: Pan view`,
            select: htmlSanitize`
                Shift: Add to selection<br>
                Ctrl/Cmd: Remove from selection<br>
                Middle Mouse: Pan view
            `,
        }[this.settings.moveMode];
        this.interactionInfoContainer.innerHTML = interactionText;
        this.interactionInfoContainer.style.display = interactionText ? 'block' : 'none';

        this.settingsChangeListeners.forEach(listener => listener(this.getSettings()));
    }

    onSettingsChange(func: (settings: RendererSettings) => void): void {
        this.settingsChangeListeners.push(func);
    }

    async relayout(): Promise<void> {
        await this.resetLayoutAsync();
    }

    /**
* Call this function whenever CSS styles have updated to make the renderer refresh all elements.
*/
    notifyStyleUpdate(): void {
        this.relayout();
    }

    zoomToView(elements: LayoutElement[] | 'all' = 'all', duration: number = ANIMATION_DURATION): void {
        if (elements === 'all') {
            this.setViewportRect(this.getContainerBounds(), duration);
        } else {
            const containers = elements.map(el => this.renderCache.layoutElements.get(el)!);
            const bounds = containers.flatMap(conts => getAllDisplayObjects(conts).map(cont => {
                const localBounds = cont.getLocalBounds();
                return new PIXI.Rectangle(
                    localBounds.x + cont.x,
                    localBounds.y + cont.y,
                    localBounds.width,
                    localBounds.height,
                );
            }));
            const rect = bounds.reduce((rect, bound) => rect.enlarge(bound));
            this.setViewportRect(rect, duration);
        }
    }

    saveAsPNG(): void {
        const container = this.pixiContainer;
        const canvas: HTMLCanvasElement = this.app.renderer.plugins.extract.canvas(container);
        canvas.toBlob((blob) => {
            const a = document.createElement('a');
            a.download = 'dace-export.png';
            a.href = URL.createObjectURL(blob);
            a.click();
        }, 'image/png');
    }

    saveAsPDF(entireContainer = false): void {
        const container = entireContainer ? this.pixiContainer : this.viewport;
        const size = entireContainer ? null : this.getViewSize();
        if (!container) throw new Error('Layouting has not finished yet!');

        (async () => {
            const blob = await pixiObjectToPdf(container, size);
            const a = document.createElement('a');
            a.download = 'dace-export.pdf';
            a.href = URL.createObjectURL(blob);
            a.click();
        })();
    }

    toggleCollapsed(element: LayoutElement): void {
        const sdfgElem = element.sdfgData;
        if (!sdfgElem) return;

        // TODO: If an exit node, find the corresponding entry node

        const attrs = element.sdfgData?.attributes;
        if (attrs && 'is_collapsed' in attrs) {
            // eslint-disable-next-line camelcase
            attrs.is_collapsed = !attrs.is_collapsed;
            this.relayout();
        }
    }

    expandAll(): void {
        traverse_sdfg(this.sdfg, (type: string, _: any, obj: any) => {
            if ('is_collapsed' in obj.attributes && !obj.type.endsWith('Exit')) {
                // eslint-disable-next-line camelcase
                obj.attributes.is_collapsed = false;
            }
        });
        this.relayout();
    }

    collapseAll(): void {
        traverse_sdfg(this.sdfg, (type: string, _: any, obj: any) => {
            if ('is_collapsed' in obj.attributes && !obj.type.endsWith('Exit')) {
                // eslint-disable-next-line camelcase
                obj.attributes.is_collapsed = true;
            }
        });
        this.relayout();
    }

    getSDFG(): SDFGData {
        return this.sdfg;
    }

    getRenderGraph(): RenderGraph | undefined {
        return this.renderGraph;
    }

    setHighlighted(elements: Iterable<LayoutElement>): void {
        const set = new Set([...elements]);
        if (!setEquals(set, this.selection.highlighted)) {
            this.selection = {
                ...this.selection,
                highlighted: set,
                hasChanged: true,
            };
            this.redrawAsync();
        }
    }

    setSelected(elements: Iterable<LayoutElement>): void {
        const set = new Set([...elements]);
        if (!setEquals(set, this.selection.selected)) {
            this.selection = {
                ...this.selection,
                selected: set,
                hasChanged: true,
            };
            this.redrawAsync();
        }
    }

}

export type RendererSettings = {
    inclusiveRanges: boolean,
    memoryVolumeOverlay: boolean,
    omitAccessNodes: boolean,
    moveMode: 'move' | 'pan' | 'select',
    runtimeMap: Record<string, any[]> | null,
};

type ElementSelection = {
    selected: ReadonlySet<LayoutElement>,
    hovered: ReadonlySet<LayoutElement>,
    highlighted: ReadonlySet<LayoutElement>,
    selectionPixiObjects: readonly RenderedLayoutElement[],
    hiddenPixiObjects: readonly RenderedLayoutElement[],
    hasChanged: boolean,
}

function createEmptyElementSelection(): ElementSelection {
    return {
        selected: new Set(),
        hovered: new Set(),
        highlighted: new Set(),
        selectionPixiObjects: [],
        hiddenPixiObjects: [],
        hasChanged: false,
    };
}

/**
 * X and Y coordinates local to `app.stage`
 */
type StageCoordinates = readonly [stageX: number, stageY: number];

type DragDetails = {
    dragStart: StageCoordinates,
    lastTick: StageCoordinates,
} & ({
    type: 'viewport' | 'minimap' | 'select',
} | {
    type: 'move-objects',
    elements: ReadonlySet<Exclude<LayoutElement, EdgeLayoutElement>>,
    edgeBeginnings: ReadonlySet<EdgeLayoutElement>,
    edgeEnds: ReadonlySet<EdgeLayoutElement>,
} | {
    type: 'move-edge-control-points',
    controlPoints: readonly (readonly [EdgeLayoutElement, number])[],
});

type MouseEventHandler = (
    evtype: typeof mouseEventTypes extends Set<infer T> ? T : never,
    event: MouseEvent,
    mousepos: { x: number, y: number },
    renderer: PixiRenderer,
    selectedElements: unknown,
    endsDrag: boolean,
) => void;

/**
 * Returns a Promise that resolves after a new frame was painted.
 * 
 * This is useful if you want to wait for things to render before continuing, eg. with a large computation.
 */
async function skipFrame(): Promise<void> {
    // Skip forward to the moment just before the next frame
    await new Promise(resolve => requestAnimationFrame(resolve));
    // Skip the frame
    await new Promise(resolve => setTimeout(resolve, 0));
}

function isDetailed(elementCount: number): boolean {
    return elementCount <= DETAILED_MODE_MAX_ELEMENTS;
}
