// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    DagreGraph,
    GraphElementInfo,
    SDFGElementGroup,
    SDFGRenderer,
} from '../../renderer/renderer';
import {
    ConditionalBlock,
    Connector,
    ControlFlowBlock,
    ControlFlowRegion,
    SDFGElement
} from '../../renderer/renderer_elements';
import { SDFV } from '../../sdfv';
import { JsonSDFG, OverlayType, Point2D } from '../../types';
import { GenericSdfgOverlay } from '../generic_sdfg_overlay';

export class CFDataDependencyLense extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = CFDataDependencyLense;

    private static readonly CONNECTOR_SPACING: number = 20;
    private static readonly CONNECTOR_WIDTH: number = 10;
    private static readonly CONNECTOR_HEIGHT: number = 10;

    private readonly connectorMap: Map<
        ControlFlowBlock, [Connector[], Connector[]]
    > = new Map();

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
                    let certain_memlet = null;
                    if (attrs.certain_reads && read in attrs.certain_reads)
                        certain_memlet = attrs.certain_reads[read];

                    const connector = new Connector(
                        {
                            name: read,
                            memlet: attrs.possible_reads[read],
                            certain_memlet: certain_memlet,
                        },
                        readIdx, sdfg, null
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
                    let certain_memlet = null;
                    if (attrs.certain_writes && write in attrs.certain_writes)
                        certain_memlet = attrs.certain_writes[write];

                    const connector = new Connector(
                        {
                            name: write,
                            memlet: attrs.possible_writes[write],
                            certain_memlet: certain_memlet,
                        },
                        writeIdx, sdfg, null
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
            const block = graph.node(gId);

            this.createConnectorsForBlock(block, sdfg);

            if (block instanceof ControlFlowRegion) {
                this.recursiveSetConnectorsGraph(block.data.graph, sdfg);
            } else if (block instanceof ConditionalBlock) {
                for (const branch of block.branches) {
                    this.createConnectorsForBlock(branch[1], sdfg);
                    this.recursiveSetConnectorsGraph(
                        branch[1].data.graph, sdfg
                    );
                }
            }
        }
    }

    public refresh(): void {
        const g = this.renderer.get_graph();
        const sdfg = this.renderer.get_sdfg();
        if (g == null)
            return;
        this.connectorMap.clear();
        this.recursiveSetConnectorsGraph(g, sdfg);
        this.renderer.draw_async();
    }

    protected shadeBlock(
        block: ControlFlowBlock, ctx: CanvasRenderingContext2D, ...args: any[]
    ): void {
        // Only draw connectors when close enough to see them
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel() ?? 0;
        if (!this.renderer.adaptiveHiding || ppp < SDFV.CONNECTOR_LOD) {
            const mPos = this.renderer.get_mousepos() ?? undefined;
            const ttCont = this.renderer.get_tooltip_container();
            const connectors = this.connectorMap.get(block);
            if (connectors) {
                for (const connector of connectors[0]) {
                    connector.hovered = false;
                    if (mPos && connector.intersect(mPos.x, mPos.y)) {
                        connector.hovered = true;
                        //if (ttCont)
                        //    connector.tooltip(ttCont);
                    }
                    connector.draw(this.renderer, ctx, mPos, {} as any);
                    connector.debug_draw(this.renderer, ctx);
                }
                for (const connector of connectors[1]) {
                    connector.hovered = false;
                    if (mPos && connector.intersect(mPos.x, mPos.y)) {
                        connector.hovered = true;
                        //if (ttCont)
                        //    connector.tooltip(ttCont);
                    }
                    connector.draw(this.renderer, ctx, mPos, {} as any);
                    connector.debug_draw(this.renderer, ctx);
                }
            }
        }
    }

    public draw(): void {
        this.shadeSDFG(() => true, true);
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
