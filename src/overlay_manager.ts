// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import { MathNode, parse, SymbolNode } from 'mathjs';
import type {
    GenericSdfgOverlay,
} from './overlays/common/generic_sdfg_overlay';
import { createElement } from './utils/utils';
import {
    Point2D,
    SDFGElementGroup,
    SDFGElementInfo,
    SymbolMap,
} from './types';
import type { SDFGRenderer } from './renderer/sdfg/sdfg_renderer';
import { SDFGElement } from './renderer/sdfg/sdfg_elements';


type SymDefinitionDialogT = HTMLDivElement & {
    _show: (sym: string, map: SymbolMap, callback: () => void) => void,
    _hide: () => void,
    _title: HTMLSpanElement,
    _content: HTMLDivElement,
    _input: HTMLInputElement,
    _map?: SymbolMap,
    _symbol?: string,
    _callback?: () => void,
};

export class SymbolResolver {

    private _symbolValueMap: SymbolMap = {};
    private symbolsToDefine: string[] = [];
    private popupDialogue?: SymDefinitionDialogT = undefined;

    public constructor(
        private readonly renderer: SDFGRenderer
    ) {
        // Initialize the symbol mapping to the graph's symbol table.
        Object.keys(
            this.renderer.sdfg?.attributes?.symbols ?? []
        ).forEach((s) => {
            const constants = this.renderer.sdfg!.attributes?.constants_prop as
                Record<string, [Record<string, unknown>, number]> | undefined;
            if (constants && Object.keys(constants).includes(s) &&
                constants[s][0].type === 'Scalar')
                this.symbolValueMap[s] = constants[s][1];
            else
                this.symbolValueMap[s] = undefined;
        });

        this.initOverlayPopupDialogue();
    }

    public removeStaleSymbols(): void {
        const toKeep: SymbolMap = {};
        for (const sym in this.renderer.sdfg?.attributes?.symbols ?? {})
            toKeep[sym] = this._symbolValueMap[sym];
        this._symbolValueMap = toKeep;
    }

    public symbolValueChanged(
        symbol: string, value: number | undefined
    ): void {
        if (symbol in this.symbolValueMap)
            this.symbolValueMap[symbol] = value;
    }

    public parseExpression(
        expr: string, mapping: SymbolMap,
        promptUnknown: boolean = false,
        callback?: () => void
    ): number | undefined {
        let result: number | undefined = undefined;
        try {
            // Ensure any expressions with the sympy symbol for 'power of' (**)
            // is cleaned by replacing with the symbol '^', which is parseable
            // by mathjs.
            const powCleaned = expr.replaceAll('**', '^');

            const exprTree = parse(powCleaned);
            if (promptUnknown) {
                this.recursivelyFindUndefinedSymbol(exprTree, mapping);
                this.promptUnknownSymbol(mapping, callback);
            } else {
                try {
                    const compiled = exprTree.compile();
                    const evaluated = compiled.evaluate(
                        mapping
                    ) as number | undefined;
                    if (evaluated !== undefined && !isNaN(evaluated) &&
                        Number.isInteger(+evaluated))
                        result = +evaluated;
                    else
                        result = undefined;
                } catch (_e) {
                    result = undefined;
                }
            }
            return result;
        } catch (exception) {
            console.error(exception);
            return result;
        }
    }

    public promptUnknownSymbol(
        mapping: SymbolMap, callback?: () => void
    ): void {
        if (this.symbolsToDefine.length > 0) {
            const symbol = this.symbolsToDefine.pop();
            if (symbol === undefined)
                return;
            this.popupDialogue?._show(
                symbol,
                mapping,
                () => {
                    this.renderer.emit(
                        'symbol_definition_changed', symbol, mapping[symbol]
                    );
                    if (callback)
                        callback();
                    this.promptUnknownSymbol(mapping, callback);
                }
            );
        }
    }

    public recursivelyFindUndefinedSymbol(
        exprTree: MathNode, mapping: SymbolMap
    ): void {
        exprTree.forEach((
            node: MathNode, _path: string, _parent: MathNode
        ) => {
            switch (node.type) {
                case 'SymbolNode':
                    {
                        const symnode = node as SymbolNode;
                        if (symnode.name && symnode.name in mapping &&
                            mapping[symnode.name] === undefined &&
                            !this.symbolsToDefine.includes(symnode.name)) {
                            // This is an undefined symbol.
                            // Ask for it to be defined.
                            this.symbolsToDefine.push(symnode.name);
                        }
                    }
                    break;
                case 'OperatorNode':
                case 'ParenthesisNode':
                    this.recursivelyFindUndefinedSymbol(node, mapping);
                    break;
                default:
                    // Ignore
                    break;
            }
        });
    }

    public initOverlayPopupDialogue(): void {
        const dBackground = createElement(
            'div', '', ['sdfv_modal_background'], document.body
        ) as HTMLDivElement & { _show: () => void; _hide: () => void };
        dBackground._show = function () {
            this.style.display = 'block';
        };
        dBackground._hide = function () {
            this.style.display = 'none';
        };

        const dialogue = createElement(
            'div', 'sdfv_overlay_dialogue', ['sdfv_modal'], dBackground
        ) as SymDefinitionDialogT;
        dialogue.addEventListener('click', (ev: Event) => {
            ev.stopPropagation();
        });
        dialogue.style.display = 'none';
        this.popupDialogue = dialogue;

        const header = createElement(
            'div', '', ['sdfv_modal_title_bar'], this.popupDialogue
        );
        this.popupDialogue._title = createElement(
            'span', '', ['sdfv_modal_title'], header
        );
        const closeBtn = createElement(
            'div', '', ['modal_close'], header
        );
        closeBtn.innerHTML = '<i class="material-symbols-outlined">' +
            'close</i>';
        closeBtn.addEventListener('click', () => {
            dialogue._hide();
        });

        const contentBox = createElement(
            'div', '', ['sdfv_modal_content_box'], this.popupDialogue
        );
        this.popupDialogue._content = createElement(
            'div', '', ['sdfv_modal_content'], contentBox
        );
        this.popupDialogue._input = createElement(
            'input', 'symbol_input', ['sdfv_modal_input_text'],
            this.popupDialogue._content
        );

        function setVal(): void {
            if (dialogue._map && dialogue._symbol) {
                const val = dialogue._input.value;
                if (val && !isNaN(+val) && Number.isInteger(+val) && +val > 0) {
                    dialogue._map[dialogue._symbol] = +val;
                    dialogue._hide();
                    if (dialogue._callback)
                        dialogue._callback();
                    return;
                }
            }
            dialogue._input.setCustomValidity('Invalid, not an integer');
        }
        this.popupDialogue._input.addEventListener(
            'keypress', (ev: KeyboardEvent) => {
                if (ev.code === 'Enter')
                    setVal();
            }
        );

        const footer = createElement(
            'div', '', ['sdfv_modal_footer_bar'], this.popupDialogue
        );
        const confirmBtn = createElement(
            'div', '', ['btn', 'btn-primary', 'sdfv_modal_confirm_button'],
            footer
        );
        confirmBtn.addEventListener('click', (_ev: MouseEvent) => {
            setVal();
        });
        const confirmBtnText = createElement(
            'span', '', [], confirmBtn
        );
        confirmBtnText.innerText = 'Confirm';
        createElement('div', '', ['clearfix'], footer);

        this.popupDialogue._show = function (
            symbol: string, map: SymbolMap, callback: () => void
        ) {
            this.style.display = 'block';
            dialogue._title.innerText = 'Define symbol ' + symbol;
            dialogue._symbol = symbol;
            dialogue._map = map;
            dialogue._callback = callback;
            dBackground._show();
        };
        this.popupDialogue._hide = function () {
            this.style.display = 'none';
            dialogue._title.innerText = '';
            dialogue._input.value = '';
            dialogue._input.setCustomValidity('');
            dBackground._hide();
        };
        dBackground.addEventListener('click', (_ev: MouseEvent) => {
            dialogue._hide();
        });
    }

    public get symbolValueMap(): SymbolMap {
        return this._symbolValueMap;
    }

}

export class OverlayManager {

    private _heatmapScalingMethod: string = 'median';
    private _heatmapScalingHistNBuckets: number = 0;
    private _heatmapScalingExpBase: number = 2;
    private _overlays: GenericSdfgOverlay[] = [];
    public readonly symbolResolver: SymbolResolver;

    public constructor(private readonly renderer: SDFGRenderer) {
        this.symbolResolver = new SymbolResolver(this.renderer);
    }

    public registerOverlay(type: typeof GenericSdfgOverlay): void {
        this.overlays.push(new type(this.renderer));
        this.renderer.drawAsync();
    }

    public registerOverlayInstance(overlay: GenericSdfgOverlay): void {
        this.overlays.push(overlay);
        this.renderer.drawAsync();
    }

    public deregisterOverlay(type: typeof GenericSdfgOverlay): void {
        this._overlays = this.overlays.filter(overlay => {
            return !(overlay instanceof type);
        });
        this.renderer.drawAsync();
    }

    public deregisterAll(except?: (typeof GenericSdfgOverlay)[]): void {
        for (const ol of this.overlays) {
            // Do not deregister the overlays given in the "except" list.
            if (except?.includes(ol.olClass))
                continue;
            this.deregisterOverlay(ol.olClass);
        }
    }

    public isOverlayActive(type: typeof GenericSdfgOverlay): boolean {
        return this.overlays.filter(overlay => {
            return overlay instanceof type;
        }).length > 0;
    }

    public getOverlay(
        type: typeof GenericSdfgOverlay
    ): GenericSdfgOverlay | undefined {
        let overlay = undefined;
        this.overlays.forEach(ol => {
            if (ol instanceof type) {
                overlay = ol;
                return;
            }
        });
        return overlay;
    }

    public onSymbolValueChanged(
        symbol: string, value: number | undefined
    ): void {
        this.symbolResolver.symbolValueChanged(symbol, value);
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public draw(): void {
        this.overlays.forEach(overlay => {
            overlay.draw();
        });
    }

    public refresh(): void {
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public on_mouse_event(
        type: string,
        ev: MouseEvent,
        mousepos: Point2D,
        elements: Record<SDFGElementGroup, SDFGElementInfo[]>,
        foreground_elem: SDFGElement | null,
        ends_drag: boolean
    ): boolean {
        /*
        let dirty = false;
        this.overlays.forEach(overlay => {
            dirty = dirty || overlay.on_mouse_event(
                type, ev, mousepos, elements,
                foreground_elem, ends_drag
            );
        });
        return dirty;
        */
        return false;
    }

    public get heatmapScalingMethod(): string {
        return this._heatmapScalingMethod;
    }

    public set heatmapScalingMethod(method: string) {
        this._heatmapScalingMethod = method;
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public get heatmapScalingHistNBuckets(): number {
        return this._heatmapScalingHistNBuckets;
    }

    public set heatmapScalingHistNBuckets(n: number) {
        this._heatmapScalingHistNBuckets = n;
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public get heatmapScalingExpBase(): number {
        return this._heatmapScalingExpBase;
    }

    public set heatmapScalingExpBase(base: number) {
        this._heatmapScalingExpBase = base;
        this.overlays.forEach(overlay => {
            overlay.refresh();
        });
    }

    public get overlays(): GenericSdfgOverlay[] {
        return this._overlays;
    }

}
