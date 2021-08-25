import { SDFGData } from '../../../../../utils/sdfg/types';
import { CompleteLayout, LayoutElement } from '../../layout';
import { RenderLayouter } from '../layouter';
import LLayouter from '../../../../../layouting/layouter/layouter';
import { getSDFGGraph } from './utils';
import { RenderGraph } from '../../../../../layouting/layoutLib';
import { AccessNode, NestedSDFG, Reduce, ScopeNode, SDFGNode, State } from '../../../../renderer_elements';
import { check_and_redirect_edge as checkAndRedirectEdge } from '../../../../../utils/sdfg/sdfg_utils';
import { calculateBoundingBox, calculateEdgeBoundingBox } from '../../../../../utils/bounding_box';
import { RendererSettings } from '../../../pixi_renderer';
import { SymbolResolver } from '../../../../../utils/symbol_resolver';
import { MemoryVolumeOverlay } from '../../../../../overlays/memory_volume_overlay';
import { RuntimeMicroSecondsOverlay } from '../../../../../overlays/runtime_micro_seconds_overlay';
// eslint-disable-next-line camelcase
import { sdfg_property_to_string } from '../../../../../utils/sdfg/display';
import RenderEdge from '../../../../../layouting/renderGraph/renderEdge';
import { htmlSanitize } from '../../../../../utils/sanitization';
import { memlet_tree_complete } from '../../../../../utils/sdfg/traversal';

/**
 * Acts as a bridge to the layouter interface in src/layouting.
 */
export class ComplexLayouter implements RenderLayouter {
    constructor(private layouter: LLayouter) { }

    layout(sdfg: SDFGData, settings: RendererSettings, symbolResolver: SymbolResolver): CompleteLayout {
        const sdfgList = {};
        const stateParentList = {};
        const relayoutedGraph = relayoutSDFG(this.layouter, sdfg, sdfgList, stateParentList, settings.omitAccessNodes);
        const mvoDetails = !settings.memoryVolumeOverlay ? null : MemoryVolumeOverlay.computeOverlay(relayoutedGraph, symbolResolver);
        const rmsoDetails = !settings.runtimeMap ? null : RuntimeMicroSecondsOverlay.computeOverlay(settings.runtimeMap, symbolResolver);
        const memletTree = memlet_tree_complete(sdfg);
        const treeIdByEdge = new Map(
            memletTree.flatMap((tree, i) => [...tree].map(edge => [edge.attributes.data, i]))
        );

        const els: LayoutElement[] = [];

        function appendGraph(graph: RenderGraph, depth: number) {
            graph.nodes().forEach(node => {
                if (node instanceof State) {
                    const el = {
                        type: 'state',
                        zIndex: depth,
                        caption: node.label(),
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        isCollapsed: node.data.state.attributes.is_collapsed,
                        sdfgData: node.data.state,
                        renderData: node,
                    } as const;
                    (node as any).layoutElement = el;
                    els.push(el);
                } else if (node instanceof SDFGNode) {
                    const nodeName = node.constructor.name;
                    const isCollapsed = node.data.node.attributes.is_collapsed;
                    const label = node instanceof ScopeNode ? node.close_label(settings)
                        : node instanceof NestedSDFG && isCollapsed ? node.data.node.attributes.label
                            : node.label();
                    const farLabel =
                        node instanceof ScopeNode ? node.far_label(settings) :
                            node instanceof Reduce ? label.substring(4, label.indexOf(',')) :
                                undefined;
                    const el = {
                        type: 'node',
                        zIndex: depth,
                        caption: nodeName === 'NestedSDFG' && !isCollapsed ? '' : label,
                        farCaption: farLabel,
                        x: node.x,
                        y: node.y,
                        width: node.width,
                        height: node.height,
                        shape: nodeName.includes('Entry') ? (isCollapsed ? 'hexagon' : 'upperHexagon')
                            : nodeName.includes('Exit') ? 'lowerHexagon'
                                : nodeName === 'Tasklet' || (nodeName === 'NestedSDFG' && isCollapsed) ? 'octagon'
                                    : nodeName === 'AccessNode' ? 'ellipse'
                                        : nodeName === 'Reduce' ? 'triangle'
                                            : 'rectangle',
                        stroke: node.getStrokeStyle(),
                        backgroundTemperature: rmsoDetails ? RuntimeMicroSecondsOverlay.getNodeTemperature(rmsoDetails, node) : undefined,
                        sdfgData: node.data.node,
                        renderData: node,
                        ...node instanceof AccessNode ? {
                            highlightingGroup: JSON.stringify(['AccessNode', node.sdfg.sdfg_list_id, label]),
                        } : {},
                    } as const;
                    (node as any).layoutElement = el;
                    els.push(el);
                } else {
                    console.error('Unknown node type!', node);
                }

                for (const connector of [...node.inConnectors, ...node.outConnectors]) {
                    if (connector.width !== connector.height) throw new Error('Connectors must be circles!');

                    const rad = connector.width / 2;
                    const el = {
                        type: 'connector',
                        zIndex: depth,
                        x: connector.x + rad,
                        y: connector.y + rad,
                        radius: rad,
                        scopedColor: connector.name.startsWith('IN_') || connector.name.startsWith('OUT_'),
                        tooltip: {
                            html: htmlSanitize`${connector.name}`,
                            style: 'connector',
                        },
                        sdfgData: (connector as any).data,
                    } as const;
                    (connector as any).layoutElement = el;
                    els.push(el);
                }

                if (node.childGraph) appendGraph(node.childGraph, depth + 1);
            });

            graph.edges().forEach(edge => {
                const edg = edge as any;
                const parentId = edg.parent_id;
                const isInterstate = parentId === null || parentId === undefined;

                // Edge tooltip


                const el = {
                    type: 'edge',
                    zIndex: depth,
                    points: edge.points.map(p => [p.x, p.y]) as any,
                    lineStyle: 'solid',
                    interstateColor: isInterstate,
                    shadeTemperature: mvoDetails && edg.data.volume > 0
                        ? 0.5 * edg.data.volume / mvoDetails.badnessScaleCenter
                        : undefined,
                    tooltip: getEdgeTooltip(edge, settings),
                    sdfgData: edg.data,
                    renderData: edg,
                    ...treeIdByEdge.has(edg.data) ? {
                        highlightingGroup: JSON.stringify(['Edge', edg.sdfg.sdfg_list_id, treeIdByEdge.get(edg.data)]),
                    } : {},
                } as const;
                edg.layoutElement = el;
                els.push(el);
            });
        }
        appendGraph(relayoutedGraph, 0);

        return {
            elements: els,
            graph: relayoutedGraph,
        };
    }
}

function relayoutSDFG(layouter: LLayouter, sdfg: SDFGData, sdfgList: unknown, stateParentList: unknown, omitAccessNodes: boolean): RenderGraph {
    const g = getSDFGGraph(sdfg, sdfgList, stateParentList, omitAccessNodes);

    layouter.layout(g);

    function postlayoutSDFG(g: RenderGraph, sdfg: SDFGData) {
        sdfg.nodes.forEach((sdfgState) => {
            const stateNode = g.node(sdfgState.id);
            if (stateNode.childGraph === null) {
                // ignore collapsed states
                return;
            }
            sdfgState.nodes?.forEach((node, id) => {
                const gnode = stateNode.childGraph?.node(id);
                if (!gnode || !gnode.childGraph || (omitAccessNodes && gnode instanceof AccessNode)) {
                    // ignore nodes that should not be drawn
                    return;
                }

                // recursively process nested sdfgs
                if (node.type === 'NestedSDFG' && !node.attributes.is_collapsed) {
                    postlayoutSDFG(gnode.childGraph, node.attributes.sdfg);
                }
            });

            sdfgState.edges?.forEach((edge, id) => {
                edge = checkAndRedirectEdge(edge, (stateNode.childGraph as any).drawn_nodes, sdfgState);
                if (!edge) return;
                const gedge = stateNode?.childGraph?.edge(id);
                if (!gedge || (omitAccessNodes && (gedge as any).data.attributes.shortcut === false)
                    || (!omitAccessNodes && (gedge as any).data.attributes.shortcut)) {
                    // if access nodes omitted, don't draw non-shortcut edges and vice versa
                    return;
                }

                gedge.updateBoundingBox();
            });
        });

        // Annotate the sdfg with its layout info
        sdfg.nodes.forEach((state) => {
            const gnode = g.node(state.id);
            state.attributes.layout = {
                x: gnode.x,
                y: gnode.y,
                width: gnode.width,
                height: gnode.height,
            };
        });

        g.edges().forEach((edge) => {
            const gedge = edge;
            const bb = calculateEdgeBoundingBox(gedge);

            // Convert from top-left to center
            gedge.x = bb.width / 2.0;
            gedge.y = bb.height / 2.0;
            gedge.width = bb.width;
            gedge.height = bb.height;
            edge.attributes.layout = {};
            edge.attributes.layout.width = bb.width;
            edge.attributes.layout.height = bb.height;
            edge.attributes.layout.x = bb.width / 2.0;
            edge.attributes.layout.y = bb.height / 2.0;
            edge.attributes.layout.points = gedge.points;
        });

        const bb = calculateBoundingBox(g);
        (g as any).width = bb.width;
        (g as any).height = bb.height;

        // Add SDFG to global store
        sdfg[sdfg.sdfg_list_id] = g;
    }

    postlayoutSDFG(g, sdfg);

    return g;
}

function getEdgeTooltip(edge: RenderEdge, settings: RendererSettings) {
    const attr = edge.attributes();
    if (attr.subset !== undefined) {
        if (attr.subset === null) {  // Empty memlet
            return undefined;
        }
        let contents = attr.data;
        contents += sdfg_property_to_string(attr.subset, settings);

        if (attr.other_subset)
            contents += ' -> ' + sdfg_property_to_string(attr.other_subset, settings);

        if (attr.wcr)
            contents += '<br /><b>CR: ' + sdfg_property_to_string(attr.wcr, settings) + '</b>';

        let numAccessesStr = '';
        if (attr.volume)
            numAccessesStr = sdfg_property_to_string(attr.volume, settings);
        else
            numAccessesStr = sdfg_property_to_string(attr.num_accesses, settings);

        const numAccesses = Number(numAccessesStr);
        if (attr.dynamic) {
            if (numAccesses === 0 || numAccesses === -1)
                numAccessesStr = '<b>Dynamic (unbounded)</b>';
            else
                numAccessesStr = '<b>Dynamic</b> (up to ' + numAccessesStr + ')';
        } else if (numAccesses === -1) {
            numAccessesStr = '<b>Dynamic (unbounded)</b>';
        }

        contents += '<br /><font style="font-size: 14px">Volume: ' + numAccessesStr + '</font>';
        return {
            html: contents,
            style: 'normal',
        } as const;
    } else {  // Interstate edge
        if (!edge.label())
            return undefined;
        return {
            html: edge.label(),
            style: 'interstate',
        } as const;
    }

}
