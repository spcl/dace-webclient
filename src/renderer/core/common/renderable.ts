// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { Point2D } from '../../../types';
import { RendererBase } from './renderer_base';


export abstract class Renderable {

    public readonly COLLAPSIBLE: boolean = false;

    // Layout information.
    public x: number = 0;
    public y: number = 0;
    public width: number = 0;
    public height: number = 0;

    public constructor(
        protected readonly _renderer: RendererBase,
        public id: number,
        public data?: Record<string, unknown>
    ) {
        this.setLayout();
    }

    public get renderer(): RendererBase {
        return this._renderer;
    }

    public get selected(): boolean {
        return this.renderer.selectedRenderables.has(this);
    }

    public get hovered(): boolean {
        return this.renderer.hoveredRenderables.has(this);
    }

    public get highlighted(): boolean {
        return this.renderer.highlightedRenderables.has(this);
    }

    public setLayout(): void {
        // Dagre does not work well with properties, only fields.
        if (this.data && Object.hasOwn(this.data, 'layout')) {
            const layout = (this.data as { layout: {
                width: number,
                height: number,
            } }).layout;
            this.width = layout.width;
            this.height = layout.height;
        }
    }

    protected abstract _internalDraw(mousepos?: Point2D): void;

    public abstract drawSummaryInfo(
        mousePos?: Point2D, overrideTooFarForText?: boolean
    ): void;

    public abstract minimapDraw(): void;

    public draw(mousePos?: Point2D): void {
        this._internalDraw(mousePos);
    }

    public simpleDraw(mousePos?: Point2D): void {
        this.draw(mousePos);
    }

    public abstract shade(color: string, alpha: number): void;

    public abstract debugDraw(overrideDebugDrawEnabled: boolean): void;

    public abstract get type(): string;

    public abstract get label(): string;

    public abstract get guid(): string;

    // Text used for matching the element during a search
    public textForFind(): string {
        return this.label;
    }

    public topleft(): Point2D {
        return { x: this.x - this.width / 2, y: this.y - this.height / 2 };
    }

    public strokeStyle(renderer?: RendererBase): string {
        if (!renderer)
            return 'black';

        if (this.selected) {
            if (this.hovered) {
                return this.getCssProperty(
                    renderer, '--color-selected-hovered'
                );
            } else if (this.highlighted) {
                return this.getCssProperty(
                    renderer, '--color-selected-highlighted'
                );
            } else {
                return this.getCssProperty(renderer, '--color-selected');
            }
        } else {
            if (this.hovered)
                return this.getCssProperty(renderer, '--color-hovered');
            else if (this.highlighted)
                return this.getCssProperty(renderer, '--color-highlighted');
        }
        return this.getCssProperty(renderer, '--color-default');
    }

    // General bounding-box intersection function. Returns true iff point or
    // rectangle intersect element.
    public intersect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        const topLeft = this.topleft();
        if (w === 0 || h === 0) {  // Point-element intersection
            return (x >= topLeft.x) && (x <= topLeft.x + this.width) &&
                (y >= topLeft.y) && (y <= topLeft.y + this.height);
        } else {                 // Box-element intersection
            return (x <= topLeft.x + this.width) && (x + w >= topLeft.x) &&
                (y <= topLeft.y + this.height) && (y + h >= topLeft.y);
        }
    }

    public fullyContainedInRect(
        x: number, y: number, w: number = 0, h: number = 0
    ): boolean {
        if (w === 0 || h === 0)
            return false;

        const boxStartX = x;
        const boxEndX = x + w;
        const boxStartY = y;
        const boxEndY = y + h;

        const elemStartX = this.x - (this.width / 2.0);
        const elemEndX = this.x + (this.width / 2.0);
        const elemStartY = this.y - (this.height / 2.0);
        const elemEndY = this.y + (this.height / 2.0);

        return boxStartX <= elemStartX &&
            boxEndX >= elemEndX &&
            boxStartY <= elemStartY &&
            boxEndY >= elemEndY;
    }

    public getCssProperty(
        renderer: RendererBase, propertyName: string
    ): string {
        return renderer.getCssProperty(propertyName);
    }

}
