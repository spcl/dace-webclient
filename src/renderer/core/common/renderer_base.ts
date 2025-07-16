// Copyright (c) Philipp Schaad and rendure authors. All rights reserved.

import { EventEmitter } from 'events';
import type { SimpleRect } from '../../../types';
import type { Renderable } from './renderable';


// Declare `vscode` to avoid TypeScript errors. If this variable is actually
// defined, the module is running inside VSCode.
declare const vscode: any;

export abstract class RendererBase extends EventEmitter {

    // Indicate whether the renderer runs inside of VSCode.
    public readonly inVSCode: boolean = false;

    protected _htmlElem?: HTMLElement;

    protected cssProps: Record<string, string> = {};

    protected readonly _hoveredRenderables = new Set<Renderable>();
    protected readonly _selectedRenderables = new Set<Renderable>();
    protected readonly _highlightedRenderables = new Set<Renderable>();

    public constructor(
        private _debugDraw: boolean = false
    ) {
        super();

        this.inVSCode = false;
        try {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            vscode;
            if (vscode)
                this.inVSCode = true;
        } catch (_ex) { }
    }

    public abstract getContentsBoundingBox(): SimpleRect;

    public abstract draw(): void;

    public abstract drawAsync(): void;

    public get hoveredRenderables(): ReadonlySet<Renderable> {
        return this._hoveredRenderables;
    }

    public get selectedRenderables(): ReadonlySet<Renderable> {
        return this._selectedRenderables;
    }

    public get highlightedRenderables(): ReadonlySet<Renderable> {
        return this._highlightedRenderables;
    }

    public hoverRenderable(renderable: Renderable): void {
        this._hoveredRenderables.add(renderable);
    }

    public unhoverRenderable(renderable: Renderable): void {
        this._hoveredRenderables.delete(renderable);
    }

    public selectRenderable(renderable: Renderable): void {
        this._selectedRenderables.add(renderable);
    }

    public deselectRenderable(renderable: Renderable): void {
        this._selectedRenderables.delete(renderable);
    }

    public highlightRenderable(renderable: Renderable): void {
        this._highlightedRenderables.add(renderable);
    }

    public unhighlightRenderable(renderable: Renderable): void {
        this._highlightedRenderables.delete(renderable);
    }

    public clearHovered(): void {
        this._hoveredRenderables.clear();
    }

    public clearSelected(): void {
        this._selectedRenderables.clear();
    }

    public clearHighlighted(): void {
        this._highlightedRenderables.clear();
    }

    // --------------
    // - Debugging: -
    // --------------

    public get debugDraw(): boolean {
        return this._debugDraw;
    }

    public enableDebugDrawing(): void {
        this._debugDraw = true;
    }

    public disableDebugDrawing(): void {
        this._debugDraw = false;
    }

    public toggleDebugDrawing(): void {
        this._debugDraw = !this._debugDraw;
    }

    // -------------------
    // - CSS properties: -
    // -------------------

    public clearCssPropertyCache(): void {
        this.cssProps = {};
    }

    public getCssProperty(propName: string): string {
        if (this.cssProps[propName])
            return this.cssProps[propName];

        if (this._htmlElem) {
            const propVal: string = window.getComputedStyle(
                this._htmlElem
            ).getPropertyValue(propName).trim();
            this.cssProps[propName] = propVal;
            return propVal;
        }
        return '';
    }

    // -----------------------
    // - Saving / exporting: -
    // -----------------------

    public save(filename: string, contents?: string): void {
        if (!contents)
            return;
        const link = document.createElement('a');
        link.setAttribute('download', filename);
        link.href = contents;
        document.body.appendChild(link);

        // Wait for the link to be added to the document, then click it.
        window.requestAnimationFrame(() => {
            const event = new MouseEvent('click');
            link.dispatchEvent(event);
            document.body.removeChild(link);
        });
    }

    public abstract saveAsPDF(filename: string): void;

}
