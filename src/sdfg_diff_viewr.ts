// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import {
    DagreGraph,
    graphFindRecursive,
    htmlSanitize,
    ISDFV,
    ISDFVUserInterface,
    JsonSDFG,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGElement,
    JsonSDFGState,
    SDFG,
    SDFGElement,
    SDFGNode,
    SDFVWebUI,
    traverseSDFGScopes,
    WebSDFV,
} from '.';
import { DiffOverlay } from './overlays/diff_overlay';
import { RendererUIFeature, SDFGRenderer } from './renderer/renderer';
import _ from 'lodash';

type ChangeState = 'nodiff' | 'changed' | 'added' | 'removed';

type localGraphDiffStackEntry = {
    guid: string | null,
    htmlLabel: string,
    changeStatus: ChangeState,
    zoomToNodes: () => SDFGNode[],
    indents: number,
    children: (localGraphDiffStackEntry | null)[],
};

const DIFF_ORDER: ChangeState[] = ['nodiff', 'removed', 'added', 'changed'];

const DIFF_IGNORE_ATTRIBUTES = [
    'guid',
    'hash',
    'sdfg',
    'orig_sdfg',
    'transformation_hist',
    'layout',
];

export interface DiffMap {
    addedKeys: Set<string>;
    removedKeys: Set<string>;
    changedKeys: Set<string>;
}

export abstract class SDFGDiffViewer implements ISDFV {

    protected diffMap?: DiffMap;

    public constructor(
        protected readonly leftRenderer: SDFGRenderer,
        protected readonly rightRenderer: SDFGRenderer
    ) {
    }

    protected destroy(): void {
        this.leftRenderer.destroy();
        this.rightRenderer.destroy();
    }

    protected async diff(graphA: JsonSDFG, graphB: JsonSDFG): Promise<DiffMap> {
        if (!graphA.attributes.guid || !graphB.attributes.guid) {
            return {
                addedKeys: new Set(),
                removedKeys: new Set(),
                changedKeys: new Set(),
            };
        }

        const elementsDictA: Map<string, any> = new Map();
        const elementsDictB: Map<string, any> = new Map();

        function recursiveAddIds(
            graph: JsonSDFGControlFlowRegion | JsonSDFGState,
            dict: Map<string, any>
        ) {
            for (const node of graph.nodes) {
                dict.set(node.attributes.guid, node);
                if (Object.hasOwn(node, 'nodes')) {
                    recursiveAddIds(
                        node as (JsonSDFGControlFlowRegion | JsonSDFGState),
                        dict
                    );
                } else if (node.type === 'NestedSDFG') {
                    recursiveAddIds(node.attributes.sdfg as JsonSDFG, dict);
                }
            }
            for (const edge of graph.edges)
                dict.set(edge.attributes.data.attributes.guid, edge);
        }

        elementsDictA.set(graphA.attributes.guid, graphA);
        recursiveAddIds(graphA, elementsDictA);
        elementsDictB.set(graphB.attributes.guid, graphB);
        recursiveAddIds(graphB, elementsDictB);

        const aKeys = new Set(elementsDictA.keys());
        const bKeys = new Set(elementsDictB.keys());

        const changedKeys: Set<string> = new Set();
        const addedKeys = bKeys.difference(aKeys);
        const removedKeys = aKeys.difference(bKeys);
        const remainingKeys = aKeys.difference(removedKeys);

        for (const key of remainingKeys) {
            const elA: JsonSDFGElement = elementsDictA.get(key);
            const elB: JsonSDFGElement = elementsDictB.get(key);

            let attrARaw: any;
            if (['MultiConnectorEdge', 'InterstateEdge'].includes(elA.type))
                attrARaw = (elA as JsonSDFGEdge).attributes?.data.attributes;
            else
                attrARaw = elA.attributes;
            const attrA: any = {};
            for (const k in attrARaw) {
                if (DIFF_IGNORE_ATTRIBUTES.includes(k))
                    continue;
                attrA[k] = attrARaw[k];
            }

            let attrBRaw: any;
            if (['MultiConnectorEdge', 'InterstateEdge'].includes(elB.type))
                attrBRaw = (elB as JsonSDFGEdge).attributes?.data.attributes;
            else
                attrBRaw = elB.attributes;
            const attrB: any = {};
            for (const k in attrBRaw) {
                if (DIFF_IGNORE_ATTRIBUTES.includes(k))
                    continue;
                attrB[k] = attrBRaw[k];
            }

            if (!_.isEqual(attrA, attrB))
                changedKeys.add(key);
        }

        this.diffMap = {
            addedKeys,
            removedKeys,
            changedKeys,
        };
        return this.diffMap;
    }

    public abstract get linkedUI(): ISDFVUserInterface;
    public abstract exitDiff(): void;
    public abstract outline(): void;

    protected findInDiffGraphPredicate(predicate: CallableFunction): void {
        const lGraph = this.leftRenderer.get_graph();
        const rGraph = this.rightRenderer.get_graph();
        if (!lGraph || !rGraph)
            return;

        SDFVWebUI.getInstance().infoSetTitle('Search Results');

        const lResults: (dagre.Node<SDFGElement> | dagre.GraphEdge)[] = [];
        graphFindRecursive(lGraph, predicate, lResults);
        const rResults: (dagre.Node<SDFGElement> | dagre.GraphEdge)[] = [];
        graphFindRecursive(rGraph, predicate, rResults);

        // Zoom to bounding box of all results first
        if (lResults.length > 0)
            this.leftRenderer.zoom_to_view(lResults);
        if (rResults.length > 0)
            this.rightRenderer.zoom_to_view(rResults);

        const addedIDs: Map<string, [any, SDFGRenderer][]> = new Map();
        const mergedResults: string[] = [];
        for (const res of lResults) {
            const existing = addedIDs.get(res.attributes().guid);
            if (existing) {
                existing.push([res, this.leftRenderer]);
            } else {
                const newEntry: [any, SDFGRenderer][] =
                    [[res, this.leftRenderer]];
                addedIDs.set(res.attributes().guid, newEntry);
                mergedResults.push(res.attributes().guid);
            }
        }
        for (const res of rResults) {
            const existing = addedIDs.get(res.attributes().guid);
            if (existing) {
                existing.push([res, this.rightRenderer]);
            } else {
                const newEntry: [any, SDFGRenderer][] =
                    [[res, this.rightRenderer]];
                addedIDs.set(res.attributes().guid, newEntry);
                mergedResults.push(res.attributes().guid);
            }
        }

        // Show clickable results in sidebar
        const sidebar = SDFVWebUI.getInstance().infoContentContainer;
        if (sidebar) {
            sidebar.html('');
            for (const resId of mergedResults) {
                const res = addedIDs.get(resId);
                if (!res)
                    continue;

                let status: ChangeState = 'nodiff';
                const guid = res[0][0].attributes().guid;
                if (this.diffMap?.changedKeys.has(guid))
                    status = 'changed';
                else if (this.diffMap?.removedKeys.has(guid))
                    status = 'removed';
                else if (this.diffMap?.addedKeys.has(guid))
                    status = 'added';

                const d = $('<div>', {
                    class: `diff-outline-entry ${status}`,
                    html: htmlSanitize`${res[0][0].type()} ${res[0][0].label()}`,
                    click: () => {
                        for (const entry of res)
                            entry[1].zoom_to_view([entry[0]]);
                    },
                });
                d.on('mouseenter', () => {
                    for (const entry of res) {
                        if (!entry[0].highlighted) {
                            entry[0].highlighted = true;
                            entry[1].draw_async();
                        }
                    }
                });
                d.on('mouseleave', () => {
                    for (const entry of res) {
                        if (entry[0].highlighted) {
                            entry[0].highlighted = false;
                            entry[1].draw_async();
                        }
                    }
                });

                sidebar.append(d);
            }
        }

        SDFVWebUI.getInstance().infoShow();
    }

}

export class WebSDFGDiffViewer extends SDFGDiffViewer {

    private readonly UI: SDFVWebUI = SDFVWebUI.getInstance();

    public get linkedUI(): SDFVWebUI {
        return this.UI;
    }

    private initUI(): void {
        $('#sdfg-file-input').prop('disabled', true);
        $('#reload').prop('disabled', true);
        $('#load-instrumentation-report-btn').prop('disabled', true);
        $('#diff-view-btn-container').hide();

        $('#exit-diff-view-btn-container').show();
    }

    private deconstructUI(): void {
        $('#sdfg-file-input').prop('disabled', false);
        $('#reload').prop('disabled', false);
        $('#load-instrumentation-report-btn').prop('disabled', false);
        $('#diff-view-btn-container').show();

        $('#exit-diff-view-btn-container').hide();
    }

    private registerEventListeners(): void {
        $(document).on(
            'click.sdfv-diff', '#exit-diff-view-btn', this.exitDiff.bind(this)
        );
        $(document).on(
            'click.sdfv-diff', '#outline', this.outline.bind(this)
        );
        $(document).on(
            'click.sdfv-diff', '#search-btn', (e) => {
                e.preventDefault();
                this.runSearch(false);
                return false;
            }
        );
        $(document).on(
            'click.sdfv-diff', '#advsearch-btn', (e) => {
                e.preventDefault();
                this.runSearch(true);
                return false;
            }
        );
        $(document).on(
            'keydown.sdfv-diff', '#search', (e) => {
                if (e.key === 'Enter' || e.which === 13) {
                    this.runSearch(false);
                    e.preventDefault();
                }
            }
        );
    }

    private deregisterEventListeners(): void {
        $(document).off('.sdfv-diff');
    }

    public exitDiff(): void {
        $('#diff-container').hide();

        this.destroy();

        this.deregisterEventListeners();
        this.deconstructUI();

        // Re-instantiate the regular SDFG viewer (SDFV).
        $('#contents').show();
        WebSDFV.getInstance().registerEventListeners();
        WebSDFV.getInstance().setSDFG(
            this.rightRenderer!.get_sdfg(),
            this.rightRenderer!.get_canvas_manager()?.get_user_transform()
        );
    }

    public static init(graphA: JsonSDFG, graphB: JsonSDFG): WebSDFGDiffViewer {
        const leftContainer = document.getElementById('diff-contents-A');
        const rightContainer = document.getElementById('diff-contents-B');
        if (!leftContainer || !rightContainer)
            throw Error('Failed to find diff renderer containers');

        const leftRenderer = new SDFGRenderer(
            graphA, leftContainer, undefined, null, null, false, null, null, [
                'settings',
                'zoom_to_fit_all',
                'zoom_to_fit_width',
                'collapse',
                'expand',
            ]
        );
        const rightRenderer = new SDFGRenderer(
            graphB, rightContainer, undefined, null, null, false, null, null, [
                'zoom_to_fit_all',
                'zoom_to_fit_width',
                'collapse',
                'expand',
            ]
        );

        const viewer = new WebSDFGDiffViewer(leftRenderer, rightRenderer);
        viewer.registerEventListeners();
        viewer.initUI();

        leftRenderer.setSDFVInstance(viewer);
        rightRenderer.setSDFVInstance(viewer);

        viewer.diff(graphA, graphB).then(diff => {
            const leftOverlay = new DiffOverlay(leftRenderer, diff);
            const rightOverlay = new DiffOverlay(rightRenderer, diff);
            leftRenderer.overlayManager.register_overlay_instance(
                leftOverlay
            );
            rightRenderer.overlayManager.register_overlay_instance(
                rightOverlay
            );
        });

        const rendererSelectionChange = (renderer: SDFGRenderer) => {
            const selectedElements = renderer.get_selected_elements();
            let element;
            if (selectedElements.length === 0)
                element = new SDFG(renderer.get_sdfg());
            else if (selectedElements.length === 1)
                element = selectedElements[0];
            else
                element = null;

            if (element !== null) {
                viewer.UI.showElementInfo(element, renderer);
            } else {
                SDFVWebUI.getInstance().infoClear();
                SDFVWebUI.getInstance().infoSetTitle(
                    'Multiple elements selected'
                );
            }
            SDFVWebUI.getInstance().infoShow();
        };
        leftRenderer.on('selection_changed', () => {
            rightRenderer.deselect();
            rendererSelectionChange(leftRenderer);
        });
        rightRenderer.on('selection_changed', () => {
            leftRenderer.deselect();
            rendererSelectionChange(rightRenderer);
        });

        return viewer;
    }

    private constructGraphOutlineBase(
        graph: DagreGraph
    ): (localGraphDiffStackEntry | null)[] {
        const elemClass = (elem: SDFGElement | JsonSDFG): ChangeState => {
            const guid = elem instanceof SDFGElement ?
                elem.attributes().guid : elem.attributes.guid;
            if (this.diffMap?.addedKeys.has(guid))
                return 'added';
            else if (this.diffMap?.removedKeys.has(guid))
                return 'removed';
            else if (this.diffMap?.changedKeys.has(guid))
                return 'changed';
            return 'nodiff';
        };

        const stack: (localGraphDiffStackEntry | null)[] = [
            {
                guid: null,
                htmlLabel: '',
                changeStatus: 'nodiff',
                zoomToNodes: () => {
                    return [];
                },
                indents: 0,
                children: [],
            },
        ];
        // Add elements to tree view in sidebar
        traverseSDFGScopes(graph, (node, parent) => {
            // Skip exit nodes when scopes are known
            if (node.type().endsWith('Exit') &&
                node.data.node.scope_entry >= 0) {
                stack.push(null);
                return true;
            }

            let is_collapsed = node.attributes().is_collapsed;
            is_collapsed = (is_collapsed === undefined) ? false : is_collapsed;
            let node_type = node.type();

            // If a scope has children, remove the name "Entry" from the type
            if (node.type().endsWith('Entry') && node.parent_id && node.id) {
                const state = node.parentElem?.data.state;
                if (state.scope_dict[node.id] !== undefined)
                    node_type = node_type.slice(0, -5);
            }

            // Create element
            const elemEntry = {
                guid: node.attributes().guid,
                htmlLabel: htmlSanitize`
                    ${node_type} ${node.label()}${is_collapsed ? ' (collapsed)' : ''}
                `,
                changeStatus: elemClass(node),
                zoomToNodes: () => {
                    const nodes_to_display = [node];
                    if (node.type().endsWith('Entry') && node.parentElem &&
                        node.id) {
                        const state = node.parentElem?.data.state;
                        if (state.scope_dict[node.id] !== undefined) {
                            for (const subnode_id of state.scope_dict[node.id])
                                nodes_to_display.push(parent.node(subnode_id));
                        }
                    }
                    return nodes_to_display;
                },
                indents: 0,
                children: [],
            };
            stack.push(elemEntry);

            // If is collapsed, don't traverse further
            if (is_collapsed)
                return false;

            return true;
        }, (_node: SDFGNode, _parent: DagreGraph) => {
            // After scope ends, pop ourselves as the current element
            // and add to parent
            const elem = stack.pop();
            if (elem)
                stack[stack.length - 1]?.children.push(elem);
        });

        return stack;
    }

    private sortChildrenByGUID(entry: localGraphDiffStackEntry): void {
        entry.children.sort((a, b) => {
            if (a && b) {
                return (
                    DIFF_ORDER.indexOf(a.changeStatus) -
                    DIFF_ORDER.indexOf(b.changeStatus)
                );
            } else if (a) {
                return -1;
            } else if (b) {
                return 1;
            }
            return 0;
        });

        for (const child of entry.children) {
            if (child)
                this.sortChildrenByGUID(child);
        }
    }

    public outline(): void {
        SDFVWebUI.getInstance().infoContentContainer.html('');
        if (!this.diffMap) {
            SDFVWebUI.getInstance().infoSetTitle('SDFG Diff Outline');
            SDFVWebUI.getInstance().infoContentContainer.text(
                'Error: No diff computed yet, please retry in a few seconds.'
            );
            SDFVWebUI.getInstance().infoShow();
            return;
        }

        const lSDFG = this.leftRenderer.get_sdfg();
        const rSDFG = this.rightRenderer.get_sdfg();
        const lGraph = this.leftRenderer.get_graph();
        const rGraph = this.rightRenderer.get_graph();
        if (!lSDFG || !rSDFG || !lGraph || !rGraph)
            return;

        SDFVWebUI.getInstance().infoSetTitle('SDFG Diff Outline');

        const container = $('<div>', {
            class: 'container-fluid',
        }).appendTo(SDFVWebUI.getInstance().infoContentContainer);

        // Entire SDFG
        const sdfgStatus = this.diffMap.changedKeys.has(lSDFG.attributes.guid) ?
            'changed' : 'nodiff';
        const leftSdfgLocalEntry: localGraphDiffStackEntry = {
            guid: lSDFG.attributes.guid,
            htmlLabel: htmlSanitize`
                <span class="material-symbols-outlined"
                      style="font-size: inherit">
                    filter_center_focus
                </span> SDFG ${lSDFG.attributes.name}
            `,
            changeStatus: sdfgStatus,
            zoomToNodes: () => {
                return [];
            },
            indents: 0,
            children: [],
        };
        leftSdfgLocalEntry.children = this.constructGraphOutlineBase(lGraph);
        this.sortChildrenByGUID(leftSdfgLocalEntry);
        const rightSdfgLocalEntry: localGraphDiffStackEntry = {
            guid: rSDFG.attributes.guid,
            htmlLabel: htmlSanitize`
                <span class="material-symbols-outlined"
                      style="font-size: inherit">
                    filter_center_focus
                </span> SDFG ${rSDFG.attributes.name}
            `,
            changeStatus: sdfgStatus,
            zoomToNodes: () => {
                return [];
            },
            indents: 0,
            children: [],
        };
        rightSdfgLocalEntry.children = this.constructGraphOutlineBase(rGraph);
        this.sortChildrenByGUID(rightSdfgLocalEntry);

        const linearizeHierarchy = (
            root: localGraphDiffStackEntry,
            linearized: localGraphDiffStackEntry[]
        ): void => {
            linearized.push(root);
            for (const child of root.children) {
                if (child) {
                    child.indents = root.indents + 1;
                    linearizeHierarchy(child, linearized);
                }
            }
        };

        const leftLinearized: localGraphDiffStackEntry[] = [];
        linearizeHierarchy(leftSdfgLocalEntry, leftLinearized);
        const rightLinearized: localGraphDiffStackEntry[] = [];
        linearizeHierarchy(rightSdfgLocalEntry, rightLinearized);

        const addElemEntry = (
            left?: localGraphDiffStackEntry, right?: localGraphDiffStackEntry
        ) => {
            if (left && !left.guid && right && !right.guid)
                return;

            if (left && right) {
                const row = $('<div>', {
                    class: `row diff-outline-entry ${left.changeStatus}`,
                    click: () => {
                        this.leftRenderer?.zoom_to_view(
                            left.zoomToNodes()
                        );
                        this.rightRenderer?.zoom_to_view(
                            right.zoomToNodes()
                        );
                    },
                }).appendTo(container);
                $('<div>', {
                    class: 'col-6 diff-outline-entry-item-l',
                    html: left.htmlLabel,
                }).appendTo(row);
                $('<div>', {
                    class: 'col-6 diff-outline-entry-item-r',
                    html: right.htmlLabel,
                }).appendTo(row);
            } else if (left) {
                const row = $('<div>', {
                    class: `row diff-outline-entry ${left.changeStatus}`,
                    click: () => {
                        this.leftRenderer?.zoom_to_view(
                            left.zoomToNodes()
                        );
                    },
                }).appendTo(container);
                $('<div>', {
                    class: 'col-6 diff-outline-entry-item-l',
                    html: left.htmlLabel,
                }).appendTo(row);
                $('<div>', {
                    class: 'col-6 diff-outline-entry-item-r',
                }).appendTo(row);
            } else if (right) {
                const row = $('<div>', {
                    class: `row diff-outline-entry ${right.changeStatus}`,
                    click: () => {
                        this.rightRenderer?.zoom_to_view(
                            right.zoomToNodes()
                        );
                    },
                }).appendTo(container);
                $('<div>', {
                    class: 'col-6 diff-outline-entry-item-l',
                }).appendTo(row);
                $('<div>', {
                    class: 'col-6 diff-outline-entry-item-r',
                    html: right.htmlLabel,
                }).appendTo(row);
            } else {
                throw Error('No element to add');
            }
        };

        let lIdx = 0;
        let rIdx = 0;
        while (lIdx < leftLinearized.length && rIdx < rightLinearized.length) {
            const lEntry = leftLinearized[lIdx];
            const rEntry = rightLinearized[rIdx];
            if (lEntry.guid === rEntry.guid) {
                addElemEntry(lEntry, rEntry);
                lIdx++;
                rIdx++;
            } else {
                if (lEntry.changeStatus === 'removed') {
                    addElemEntry(lEntry, undefined);
                    lIdx++;
                } else if (rEntry.changeStatus === 'added') {
                    addElemEntry(undefined, rEntry);
                    rIdx++;
                } else {
                    throw Error('Unexpected or unknown change status');
                }
            }
        }

        SDFVWebUI.getInstance().infoShow();
    }

    public runSearch(advanced: boolean = false): void {
        // Make sure the UI is not blocked during search.
        setTimeout(() => {
            const query = advanced ? $('#advsearch').val() : $('#search').val();
            if (query) {
                if (advanced) {
                    const predicate = eval(query.toString());
                    this.findInDiffGraphPredicate(predicate);
                } else {
                    const caseSensitive = $('#search-case').is(':checked');
                    const queryString = caseSensitive ?
                        query.toString() : query.toString().toLowerCase();
                    this.findInDiffGraphPredicate(
                        (g: DagreGraph, elem: SDFGElement) => {
                            const text = caseSensitive ? elem.text_for_find() :
                                elem.text_for_find().toLowerCase();
                            return text.indexOf(queryString) !== -1;
                        }
                    );
                }
            }
        }, 1);
    }

}
