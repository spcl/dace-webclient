// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    SDFGRenderer,
} from '../../renderer/sdfg/sdfg_renderer';
import {
    ConditionalBlock,
    Connector,
    ControlFlowBlock,
    ControlFlowRegion,
    NestedSDFG,
    State,
} from '../../renderer/sdfg/sdfg_elements';
import { SDFV } from '../../sdfv';
import { JsonSDFG, OverlayType } from '../../types';
import { GenericSdfgOverlay } from '../common/generic_sdfg_overlay';

export class CFDataDependencyLense extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = CFDataDependencyLense;

    public static readonly CONNECTOR_SPACING: number = 15;
    public static readonly CONNECTOR_WIDTH: number = 8;
    public static readonly CONNECTOR_HEIGHT: number = 8;

    private readonly connectorMap = new Map<
        ControlFlowBlock, [Connector[], Connector[]]
    >();

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    private createConnectorsForBlock(
        block: ControlFlowBlock, sdfg: JsonSDFG
    ): void {
        const readConnectors: Connector[] = [];
        const writeConnectors: Connector[] = [];

        const attrs = block.attributes();
        if (attrs) {
            if (attrs.possible_reads) {
                let readIdx = 0;
                for (const read in attrs.possible_reads) {
                    let certainAccess = null;
                    if (attrs.certain_reads &&
                        read in (attrs.certain_reads as object)) {
                        certainAccess = (
                            attrs.certain_reads as Record<string, unknown>
                        )[read];
                    }

                    const connector = new Connector(
                        {
                            name: read,
                            access: (
                                attrs.possible_reads as Record<string, unknown>
                            )[read],
                            certainAccess: certainAccess,
                        },
                        readIdx, sdfg, undefined
                    );
                    connector.connectorType = 'in';
                    connector.linkedElem = block;
                    readConnectors.push(connector);
                    readIdx++;
                }
            }
            if (attrs.possible_writes) {
                let writeIdx = 0;
                for (const write in attrs.possible_writes) {
                    let certainAccess = null;
                    if (attrs.certain_writes &&
                        write in (attrs.certain_writes as object)) {
                        certainAccess = (
                            attrs.certain_writes as Record<string, unknown>
                        )[write];
                    }

                    const connector = new Connector(
                        {
                            name: write,
                            access: (
                                attrs.possible_writes as Record<string, unknown>
                            )[write],
                            certainAccess: certainAccess,
                        },
                        writeIdx, sdfg, undefined
                    );
                    connector.connectorType = 'out';
                    connector.linkedElem = block;
                    writeConnectors.push(connector);
                    writeIdx++;
                }
            }
        }

        this.connectorMap.set(block, [readConnectors, writeConnectors]);

        let i = 0;
        const baseInY = block.y - block.height / 2;
        const baseInX = (block.x - (block.width / 2)) + (
            CFDataDependencyLense.CONNECTOR_SPACING / 2
        );
        const baseOutX = baseInX;
        const baseOutY = baseInY + block.height;
        for (const connector of readConnectors) {
            connector.x = baseInX + i * CFDataDependencyLense.CONNECTOR_SPACING;
            connector.y = baseInY;
            connector.width = CFDataDependencyLense.CONNECTOR_WIDTH;
            connector.height = CFDataDependencyLense.CONNECTOR_HEIGHT;
            i++;
        }
        i = 0;
        for (const connector of writeConnectors) {
            connector.x = baseOutX + (
                i * CFDataDependencyLense.CONNECTOR_SPACING
            );
            connector.y = baseOutY;
            connector.width = CFDataDependencyLense.CONNECTOR_WIDTH;
            connector.height = CFDataDependencyLense.CONNECTOR_HEIGHT;
            i++;
        }
    }

    private recursiveSetConnectorsGraph(
        graph: DagreGraph, sdfg: JsonSDFG
    ): void {
        for (const gId of graph.nodes()) {
            const block = graph.node(gId) as ControlFlowBlock;

            this.createConnectorsForBlock(block, sdfg);

            if (block instanceof ControlFlowRegion) {
                if (block.graph)
                    this.recursiveSetConnectorsGraph(block.graph, sdfg);
            } else if (block instanceof ConditionalBlock) {
                if (!block.attributes()?.is_collapsed) {
                    for (const branch of block.branches) {
                        this.createConnectorsForBlock(branch[1], sdfg);
                        if (!branch[1].attributes()?.is_collapsed &&
                            branch[1].graph) {
                            this.recursiveSetConnectorsGraph(
                                branch[1].graph, sdfg
                            );
                        }
                    }
                }
            } else if (block instanceof State) {
                if (!block.attributes()?.is_collapsed) {
                    const stateGraph = block.graph;
                    if (stateGraph) {
                        for (const nId of stateGraph.nodes()) {
                            const node = stateGraph.node(nId);
                            if (node instanceof NestedSDFG &&
                                !node.attributes()?.is_collapsed &&
                                node.graph) {
                                this.recursiveSetConnectorsGraph(
                                    node.graph, node.sdfg
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    public refresh(): void {
        if (!this.renderer.graph)
            return;
        this.connectorMap.clear();
        this.recursiveSetConnectorsGraph(
            this.renderer.graph, this.renderer.sdfg
        );
        this.renderer.drawAsync();
    }

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ..._args: any[]
    ): void {
        // Only draw connectors when close enough to see them.
        const ppp = this.renderer.canvasManager.pointsPerPixel;
        if (!this.renderer.adaptiveHiding || ppp < SDFV.CONNECTOR_LOD) {
            const mPos = this.renderer.getMousePos() ?? undefined;
            const connectors = this.connectorMap.get(block);
            if (connectors) {
                for (const connector of connectors[0]) {
                    connector.hovered = false;
                    if (mPos && connector.intersect(mPos.x, mPos.y))
                        connector.hovered = true;
                        //if (ttCont)
                        //    connector.tooltip(ttCont);
                    connector.draw(this.renderer, ctx, mPos, undefined);
                    connector.debugDraw(this.renderer, ctx);
                }
                for (const connector of connectors[1]) {
                    connector.hovered = false;
                    if (mPos && connector.intersect(mPos.x, mPos.y))
                        connector.hovered = true;
                        //if (ttCont)
                        //    connector.tooltip(ttCont);
                    connector.draw(this.renderer, ctx, mPos, undefined);
                    connector.debugDraw(this.renderer, ctx);
                }
            }
        }
    }

    public draw(): void {
        this.shadeSDFG(() => true, true);
    }

}
