// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import EventEmitter from 'events';
import { SimpleRect } from '../../../types';


// Some global functions and variables which are only accessible within VSCode:
declare const vscode: any;

export abstract class RendererBase extends EventEmitter {

    // Indicate whether the renderer runs inside of VSCode.
    public readonly inVSCode: boolean = false;

    protected _htmlElem?: HTMLElement;

    protected cssProps: Record<string, string> = {};

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
