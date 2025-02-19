// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../../renderer/renderer';
import {
    LoopRegion,
    SDFGElement,
    SDFGElementType,
} from '../../renderer/renderer_elements';
import { SDFV } from '../../sdfv';
import {
    JsonSDFG,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGState,
    OverlayType,
    Point2D,
} from '../../types';
import { SDFVSettings } from '../../utils/sdfv_settings';
import { GenericSdfgOverlay } from '../generic_sdfg_overlay';

interface ControlFlowEntry {
    position: {
        x: number,
        y: number,
    },
    height: number,
    linkedElem?: SDFGElement,
    lastParentElem?: SDFGElement,
}

interface LoopEntry extends ControlFlowEntry {
    children: ControlFlowEntry[],
    conditional: boolean,
    nExecs: number,
    label: string,
}

interface ConditionalEntry extends ControlFlowEntry {
    branches: ControlFlowEntry[][];
}

export class LoopNestLense extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.LENSE;
    public readonly olClass: typeof GenericSdfgOverlay = LoopNestLense;

    private static readonly LANE_OFFSET_X = -40;
    private static readonly LOOP_ENTRY_HEIGHT = 10;
    private static readonly LOOP_ENTRY_WIDTH = 20;

    private loops: ControlFlowEntry[] = [];

    public constructor(renderer: SDFGRenderer) {
        super(renderer);
        this.refresh();
    }

    private recursivelyCountLoops(
        b: ControlFlowEntry[], all: boolean = false
    ): number {
        let numberOfLoops = 0;
        for (const bEntry of b) {
            if (Object.hasOwn(bEntry, 'nExecs')) {
                numberOfLoops++;
                if (all) {
                    numberOfLoops += this.recursivelyCountLoops(
                        (bEntry as LoopEntry).children, all
                    );
                }
            } else {
                const nbEntry = bEntry as ConditionalEntry;
                let maxNLoops = 0;
                for (const nb of nbEntry.branches) {
                    maxNLoops = Math.max(
                        maxNLoops, this.recursivelyCountLoops(nb, all)
                    );
                }
                numberOfLoops += maxNLoops;
            }
        }
        return numberOfLoops;
    }

    private recursivelyConstructLoopsList(
        cfg: JsonSDFGControlFlowRegion, loopList: ControlFlowEntry[],
        conditional: boolean = false
    ): void {
        for (const nd of cfg.nodes) {
            if (nd.type === SDFGElementType.ConditionalBlock) {
                const cond = nd as JsonSDFGConditionalBlock;
                const allBranches: ControlFlowEntry[][] = [];
                for (const branch of cond.branches) {
                    const branchList: ControlFlowEntry[] = [];
                    this.recursivelyConstructLoopsList(
                        branch[1], branchList, true
                    );
                    allBranches.push(branchList);
                }

                const cleanedBranches: ControlFlowEntry[][] = [];
                for (const branch of allBranches) {
                    if (this.recursivelyCountLoops(branch) > 0)
                        cleanedBranches.push(branch);
                }
                if (cleanedBranches.length > 1) {
                    const condEntry: ConditionalEntry = {
                        branches: cleanedBranches,
                        position: {
                            x: 0,
                            y: 0,
                        },
                        height: 0,
                    };
                    loopList.push(condEntry);
                } else if (cleanedBranches.length == 0) {
                    continue;
                } else {
                    for (const entry of cleanedBranches[0])
                        loopList.push(entry);
                }
            } else if (nd.type === SDFGElementType.LoopRegion) {
                const cfgList = this.renderer.getCFGList();
                const cfgTree = this.renderer.getCFGTree();
                let pivotCfg = cfgList[cfg.cfg_list_id];
                let lastParent: SDFGElement | undefined = pivotCfg.graph?.node(
                    nd.id.toString()
                );
                const linkedLoopElem = lastParent;
                while (!lastParent) {
                    let pivotElemId = pivotCfg.jsonObj.id?.toString();
                    if (pivotElemId === undefined) {
                        // Reached an SDFG.
                        if (pivotCfg.jsonObj.cfg_list_id === 0) {
                            // Top SDFG.
                            lastParent = undefined; 
                            break;
                        } else {
                            if (!pivotCfg.nsdfgNode) {
                                // Find the state this nested SDFG is in.
                                const qGuid = pivotCfg.jsonObj.attributes.guid;
                                const parentCfgId = cfgTree[
                                    pivotCfg.jsonObj.cfg_list_id
                                ];
                                const parentCfg = cfgList[parentCfgId];
                                for (const b of parentCfg.jsonObj.nodes) {
                                    if (b.type === SDFGElementType.SDFGState) {
                                        const state = b as JsonSDFGState;
                                        for (const dfnode of state.nodes) {
                                            if (dfnode.type ===
                                                SDFGElementType.NestedSDFG &&
                                                dfnode.attributes.sdfg &&
                                                dfnode.attributes.sdfg.attributes.guid == qGuid) {
                                                pivotElemId = state.id.toString();
                                            }
                                        }
                                    }
                                }
                            } else {
                                lastParent = pivotCfg.nsdfgNode;
                                break;
                            }
                        }
                    }
                    const parentCfgId = cfgTree[pivotCfg.jsonObj.cfg_list_id];
                    const parentCfg = cfgList[parentCfgId];
                    pivotCfg = parentCfg;
                    lastParent = pivotCfg.graph?.node(pivotElemId);
                }
                const entry: LoopEntry = {
                    children: [],
                    conditional: conditional,
                    height: 0,
                    position: {
                        x: 0,
                        y: 0,
                    },
                    nExecs: 0,
                    label: nd.label,
                    linkedElem: linkedLoopElem,
                    lastParentElem: lastParent,
                };
                loopList.push(entry);
                this.recursivelyConstructLoopsList(
                    nd as JsonSDFGControlFlowRegion, entry.children, conditional
                );
            } else if (Object.hasOwn(nd, 'cfg_list_id')) {
                this.recursivelyConstructLoopsList(
                    nd as JsonSDFGControlFlowRegion, loopList, conditional
                );
            } else if (nd.type === SDFGElementType.SDFGState) {
                for (const n of (nd as JsonSDFGState).nodes) {
                    if (n.type === SDFGElementType.NestedSDFG) {
                        this.recursivelyConstructLoopsList(
                            n.attributes.sdfg as JsonSDFGControlFlowRegion,
                            loopList, conditional
                        );
                    }
                }
            }
        }
    }

    private constructLoopNestGraph(graph: DagreGraph, sdfg: JsonSDFG): void {
        this.recursivelyConstructLoopsList(sdfg, this.loops);
    }

    public refresh(): void {
        this.loops = [];

        const g = this.renderer.get_graph();
        const sdfg = this.renderer.get_sdfg();
        if (g == null)
            return;

        this.constructLoopNestGraph(g, sdfg);

        this.layout();

        this.draw();
    }

    private layoutLoop(
        loop: LoopEntry, posX: number = 0, posY: number = 0,
        parent?: SDFGElement
    ): void {
        let minHeight = 0;
        loop.position.x = posX;
        if (!loop.linkedElem) {
            if (loop.lastParentElem && loop.lastParentElem !== parent) {
                loop.position.y = loop.lastParentElem.topleft().y;
                //minHeight = loop.lastParentElem.height;
            } else {
                loop.position.y = posY
            }
        } else {
            // If a linked element is found, lay the height out based on that.
            loop.position.y = loop.linkedElem.topleft().y;
            minHeight = loop.linkedElem.height;
        }

        let contentHeight = 0;
        let offsX = -LoopNestLense.LOOP_ENTRY_WIDTH;
        let offsY = LoopNestLense.LOOP_ENTRY_HEIGHT;
        for (const child of loop.children) {
            if (Object.hasOwn(child, 'nExecs')) {
                const childLoop = child as LoopEntry;
                this.layoutLoop(
                    childLoop, loop.position.x + offsX, loop.position.y + offsY,
                    loop.linkedElem
                );
                offsY += childLoop.height;
                contentHeight += childLoop.height;
            } else {
                console.log('here');
            }
        }

        loop.height = Math.max(
            minHeight, contentHeight + LoopNestLense.LOOP_ENTRY_HEIGHT
        );
    }

    private layoutConditional(conditional: ConditionalEntry): void {
    }

    private layout(): void {
        for (const entry of this.loops) {
            if (Object.hasOwn(entry, 'nExecs')) {
                this.layoutLoop(
                    entry as LoopEntry, 0 + LoopNestLense.LANE_OFFSET_X
                );
            } else {
                this.layoutConditional(entry as ConditionalEntry);
            }
        }
    }

    private drawLoop(loop: LoopEntry, ctx: CanvasRenderingContext2D): void {
        if (loop.conditional) {
            ctx.fillStyle = SDFVSettings.get<string>(
                'stateBackgroundColor'
            );
        } else {
            ctx.fillStyle = SDFVSettings.get<string>('interstateEdgeColor');
        }
        ctx.fillRect(
            loop.position.x, loop.position.y, LoopNestLense.LOOP_ENTRY_WIDTH,
            loop.height
        );

        ctx.strokeStyle = SDFVSettings.get<string>('defaultTextColor');
        ctx.strokeRect(
            loop.position.x, loop.position.y, LoopNestLense.LOOP_ENTRY_WIDTH,
            loop.height
        );

        ctx.fillStyle = SDFVSettings.get<string>('defaultTextColor');
        const oldFont = ctx.font;
        let font_size = SDFV.DEFAULT_CANVAS_FONTSIZE * 0.5;
        ctx.font = font_size + 'px sans-serif';
        const labelMeasurements = ctx.measureText(loop.label);
        ctx.fillText(
            loop.label,
            loop.position.x - (labelMeasurements.width + SDFV.LABEL_MARGIN_V),
            loop.position.y + (
                labelMeasurements.fontBoundingBoxAscent + SDFV.LABEL_MARGIN_V
            )
        );
        ctx.font = oldFont;

        for (const child of loop.children) {
            if (Object.hasOwn(child, 'nExecs')) {
                const childLoop = child as LoopEntry;
                this.drawLoop(childLoop, ctx);
            } else {
                console.log('here');
            }
        }
    }

    private drawConditional(
        cond: ConditionalEntry, ctx: CanvasRenderingContext2D
    ): void {
    }

    public draw(): void {
        const ctx = this.renderer.get_context();
        if (ctx) {
            for (const entry of this.loops) {
                if (Object.hasOwn(entry, 'nExecs'))
                    this.drawLoop(entry as LoopEntry, ctx);
                else
                    this.drawConditional(entry as ConditionalEntry, ctx);
            }
        }
    }

    public on_mouse_event(
        _type: string,
        _ev: MouseEvent,
        _mousepos: Point2D,
        _elements: Record<SDFGElementGroup, GraphElementInfo[]>,
        _foreground_elem: SDFGElement | null,
        _ends_drag: boolean
    ): boolean {
        return false;
    }

}
