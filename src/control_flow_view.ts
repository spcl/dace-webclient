// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../scss/control_flow_view.scss';
import {
    checkCompatLoad,
    parseSDFG,
    readOrDecompress,
} from './utils/sdfg/json_serializer';
import { JsonSDFG } from './types';
import {
    CFVBasicBlock,
    CFVConditional,
    CFVControlFlowBlock,
    CFVConnector,
    CFVDependencyEdge,
    CFVElement,
    CFVLoop,
    CFVSequence,
} from './renderer/control_flow_view/control_flow_view_elements';
import {
    ControlFlowViewRenderer,
} from './renderer/control_flow_view/control_flow_view_renderer';


export class ControlFlowView {

    private sdfg?: JsonSDFG;
    private jsonRootSequence?: Record<string, unknown>;
    public readonly elementMap = new Map<string, CFVElement>();

    protected dependencyMode?: string;

    private readonly depEdgeMap = new Map<string, CFVDependencyEdge>();

    private readonly renderer: ControlFlowViewRenderer;

    public constructor() {
        $(document).on(
            'change.sdfv', '#sdfg-file-input',
            this.loadSDFG.bind(this)
        );
        $(document).on(
            'change.sdfv', '#control-flow-report-file-input',
            this.loadControlFlowReport.bind(this)
        );
        $(document).on(
            'change.sdfv', '#cf-overview-mode-input',
            this.reconstruct.bind(this)
        );

        this.dependencyMode = $('#cf-overview-mode-input').val()?.toString();

        const container = $('#cf-view-contents');
        this.renderer = new ControlFlowViewRenderer(container);
    }

    public loadSDFG(changeEvent: JQuery.TriggeredEvent): void {
        const target = changeEvent.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1)
            return;
        const file = target?.files?.[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result)
                this.sdfg = checkCompatLoad(parseSDFG(result));
        };
        fileReader.readAsArrayBuffer(file);
    }

    private blockConstructDepsImprecise(block: CFVControlFlowBlock): void {
        const selfDependencies = new Set();
        const inputs = (
            block.data?.inputs ?? {}
        ) as Record<string, [Record<string, unknown>, string[]]>;
        for (const data in inputs) {
            const dependency = inputs[data];
            if (dependency[1].length > 0) {
                const connector = new CFVConnector(data);
                for (const depId of dependency[1]) {
                    const identifier = block.guid + '_' + depId;
                    const existingEdge = this.depEdgeMap.get(identifier);
                    if (existingEdge !== undefined) {
                        existingEdge.label = existingEdge.label + '\n' + data;
                    } else {
                        const src = this.elementMap.get(depId);
                        if (!src || !(src instanceof CFVControlFlowBlock))
                            throw Error('Uhoh');
                        else if (src === block)
                            selfDependencies.add(data);
                        const depEdge = new CFVDependencyEdge(
                            data, dependency[0], src, block
                        );
                        this.depEdgeMap.set(identifier, depEdge);
                        connector.edges.push(depEdge);
                    }
                }

                block.inConnectors.push(connector);
            }
        }
        const outputs = (
            block.data?.outputs ?? {}
        ) as Record<string, [Record<string, unknown>, string[]]>;
        for (const data in outputs) {
            const dependency = outputs[data];
            if (dependency[1].length > 0) {
                const connector = new CFVConnector(data);
                for (const depId of dependency[1]) {
                    const identifier = depId + '_' + block.guid;
                    const existingEdge = this.depEdgeMap.get(identifier);
                    if (existingEdge !== undefined) {
                        existingEdge.label = existingEdge.label + '\n' + data;
                    } else {
                        const dst = this.elementMap.get(depId);
                        if (!dst || !(dst instanceof CFVControlFlowBlock)) {
                            throw Error('Uhoh');
                        } else if (dst === block) {
                            if (!selfDependencies.has(data))
                                throw Error('Uhoh');
                            else
                                continue;
                        }
                        const depEdge = new CFVDependencyEdge(
                            data, dependency[0], block, dst
                        );
                        this.depEdgeMap.set(identifier, depEdge);
                        connector.edges.push(depEdge);
                    }
                }

                block.outConnectors.push(connector);
            }
        }
    }

    private blockConstructDeps(block: CFVControlFlowBlock): void {
        if (this.dependencyMode === 'imprecise') {
            this.blockConstructDepsImprecise(block);
            return;
        }

        const inputs = (
            block.data?.inputs ?? {}
        ) as Record<string, [Record<string, unknown>, string[]]>;
        const selfDependencies = new Set();
        for (const data in inputs) {
            const dependency = inputs[data];
            if (dependency[1].length > 0) {
                const connector = new CFVConnector(data);

                for (const depId of dependency[1]) {
                    const oBlock = this.elementMap.get(depId);
                    if (!oBlock || !(oBlock instanceof CFVControlFlowBlock))
                        throw Error('Uhoh');
                    else if (oBlock === block)
                        selfDependencies.add(data);
                    const depEdge = new CFVDependencyEdge(
                        data, dependency[0], oBlock, block
                    );
                    connector.edges.push(depEdge);
                }

                block.inConnectors.push(connector);
            }
        }
        const outputs = (
            block.data?.outputs ?? {}
        ) as Record<string, [Record<string, unknown>, string[]]>;
        for (const data in outputs) {
            const dependency = outputs[data];
            if (dependency[1].length > 0) {
                const connector = new CFVConnector(data);

                for (const depId of dependency[1]) {
                    const dst = this.elementMap.get(depId);
                    if (!dst || !(dst instanceof CFVControlFlowBlock)) {
                        throw Error('Uhoh');
                    } else if (dst === block) {
                        if (!selfDependencies.has(data))
                            throw Error('Uhoh');
                        else
                            continue;
                    }
                    const depEdge = new CFVDependencyEdge(
                        data, dependency[0], block, dst
                    );
                    connector.edges.push(depEdge);
                }

                block.outConnectors.push(connector);
            }
        }
    }

    private constructEdgesForSequence(sequence: CFVSequence): void {
        for (const block of sequence.children) {
            this.blockConstructDeps(block);
            if (block instanceof CFVSequence) {
                this.constructEdgesForSequence(block);
            } else if (block instanceof CFVConditional) {
                for (const branch of block.branches)
                    this.constructEdgesForSequence(branch[1]);
            }
        }
    }

    private parseControlSequence(
        sequence: Record<string, unknown>, parent?: CFVControlFlowBlock
    ): CFVSequence {
        const result = (sequence.type === 'Loop' ?
            new CFVLoop(sequence, parent) :
            new CFVSequence(sequence, parent));
        const children = sequence.children as Record<string, unknown>[];
        for (const block of children) {
            if (block.type === 'BasicBlock') {
                const basicBlock = new CFVBasicBlock(block, result);
                result.children.push(basicBlock);
                this.elementMap.set(basicBlock.guid, basicBlock);
            } else if (block.type === 'Conditional') {
                const conditional = new CFVConditional(block, result);
                this.elementMap.set(conditional.guid, conditional);
                const branches =
                    block.branches as [string, Record<string, unknown>][];
                for (const b of branches) {
                    const condition = b[0];
                    const branch = b[1];
                    const branchSequence = this.parseControlSequence(
                        branch, conditional
                    );
                    conditional.branches.push([condition, branchSequence]);
                }
                result.children.push(conditional);
            } else if (block.type === 'Loop') {
                const loop = this.parseControlSequence(block, result);
                result.children.push(loop);
            }
        }
        this.elementMap.set(result.guid, result);
        return result;
    }

    public loadControlFlowReport(changeEvent: JQuery.TriggeredEvent): void {
        const target = changeEvent.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1)
            return;
        const file = target?.files?.[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                this.jsonRootSequence = JSON.parse(
                    readOrDecompress(result)[0]
                ) as Record<string, unknown> | undefined;
                this.reconstruct();
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    private reconstruct(): void {
        if (!this.jsonRootSequence)
            return;

        this.dependencyMode = $('#cf-overview-mode-input').val()?.toString();
        this.depEdgeMap.clear();

        this.renderer.cfSequence = undefined;
        this.renderer.cfSequence = this.parseControlSequence(
            this.jsonRootSequence
        );
        this.constructEdgesForSequence(this.renderer.cfSequence);
        this.renderer.layout();
        this.renderer.drawAsync();
    }

    /*
    public onMouseEvent(
        event: any,
        compXFunc: (event: any) => number,
        compYFunc: (event: any) => number,
        evtype: string = 'other'
    ): boolean {
        if (!this.rootSequence)
            return false;

        let dirty = false;
        let elementFocusChanged = false;
        let selectionChanged = false;

        if (evtype === 'mousedown' || evtype === 'touchstart') {
            this.dragStart = event;
        } else if (evtype === 'mouseup') {
            this.dragStart = null;
        } else if (evtype === 'touchend') {
            if (event.touches.length === 0)
                this.dragStart = null;
            else
                this.dragStart = event;
        } else if (evtype === 'mousemove') {
            // Calculate the change in mouse position in canvas coordinates
            const oldMousepos = this.mousepos;
            this.mousepos = {
                x: compXFunc(event),
                y: compYFunc(event),
            };
            this.realMousepos = { x: event.clientX, y: event.clientY };

            if (this.dragStart && event.buttons & 1) {
                this.dragging = true;

                // Mouse move in panning mode
                if (this.visibleRect) {
                    this.canvasManager.translate(
                        event.movementX, event.movementY
                    );

                    // Mark for redraw
                    dirty = true;
                }
            } else if (this.dragStart && event.buttons & 4) {
                // Pan the view with the middle mouse button
                this.dragging = true;
                if (this.visibleRect) {
                    this.canvasManager.translate(
                        event.movementX, event.movementY
                    );
                    dirty = true;
                }
                elementFocusChanged = true;
            } else {
                this.dragStart = null;
                if (event.buttons & 1 || event.buttons & 4)
                    return true; // Don't stop propagation
            }
        } else if (evtype === 'touchmove') {
            if (this.dragStart.touches.length !== event.touches.length) {
                // Different number of touches, ignore and reset drag_start
                this.dragStart = event;
            } else if (event.touches.length === 1) { // Move/drag
                if (this.visibleRect) {
                    const movX = (
                        event.touches[0].clientX -
                        this.dragStart.touches[0].clientX
                    );
                    const movY = (
                        event.touches[0].clientY -
                        this.dragStart.touches[0].clientY
                    );

                    this.canvasManager.translate(movX, movY);
                }
                this.dragStart = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            } else if (event.touches.length === 2) {
                // Find relative distance between two touches before and after.
                // Then, center and zoom to their midpoint.
                const touch1 = this.dragStart.touches[0];
                const touch2 = this.dragStart.touches[1];
                let x1 = touch1.clientX, x2 = touch2.clientX;
                let y1 = touch1.clientY, y2 = touch2.clientY;
                const oldCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];
                const initialDistance = Math.sqrt(
                    (x1 - x2) ** 2 + (y1 - y2) ** 2
                );
                x1 = event.touches[0].clientX; x2 = event.touches[1].clientX;
                y1 = event.touches[0].clientY; y2 = event.touches[1].clientY;
                const currentDistance = Math.sqrt(
                    (x1 - x2) ** 2 + (y1 - y2) ** 2
                );
                const newCenter = [(x1 + x2) / 2.0, (y1 + y2) / 2.0];

                if (this.visibleRect) {
                    // First, translate according to movement of center point
                    const movX = newCenter[0] - oldCenter[0];
                    const movY = newCenter[1] - oldCenter[1];

                    this.canvasManager.translate(movX, movY);

                    // Then scale
                    this.canvasManager.scale(
                        currentDistance / initialDistance, newCenter[0],
                        newCenter[1]
                    );
                }

                this.dragStart = event;

                // Mark for redraw
                dirty = true;
                this.draw_async();
                return false;
            }
        } else if (evtype === 'wheel') {
            // Get physical x,y coordinates (rather than canvas coordinates)
            const br = this.canvas.getBoundingClientRect();
            const x = event.clientX - (br ? br.x : 0);
            const y = event.clientY - (br ? br.y : 0);
            this.canvasManager.scale(event.deltaY > 0 ? 0.9 : 1.1, x, y);
            dirty = true;
            elementFocusChanged = true;
        }

        if (!this.mousepos)
            return true;

        const elementsUnderCursor = this.findElementsUnderCursor(
            this.mousepos.x, this.mousepos.y
        );
        const foregroundElem = elementsUnderCursor.foregroundElement;

        if (foregroundElem) {
            if (foregroundElem != this.hoveredElement) {
                if (this.hoveredElement)
                    this.hoveredElement.hovered = false;
                elementFocusChanged = true;
                this.hoveredElement = foregroundElem;
                this.hoveredElement.hovered = true;
            }
        } else {
            if (this.hoveredElement) {
                this.hoveredElement.hovered = false;
                this.hoveredElement = undefined;
                elementFocusChanged = true;
            }
        }

        if (elementFocusChanged) {
            if (!this.hoveredElement)
                this.hideTooltip();
            dirty = true;
        }

        if (evtype === 'dblclick') {
            if (foregroundElem) {
                if (foregroundElem instanceof CFVSequence ||
                    foregroundElem instanceof CFVConditional) {
                    foregroundElem.toggleCollapse();
                    this.layout();
                    dirty = true;
                }
            }
        } else if (evtype === 'click') {
            if (this.dragging) {
                this.dragging = false;
            } else {
                this.selectedElement?.deselect();
                if (elementsUnderCursor.foregroundElement) {
                    this.selectedElement =
                        elementsUnderCursor.foregroundElement;
                    this.selectedElement.select(this);
                }
                dirty = true;
            }
        }

        if (dirty)
            this.draw_async();

        return false;
    }
    */

}

$(() => {
    new ControlFlowView();
});
