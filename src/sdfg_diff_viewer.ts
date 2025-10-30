// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import _ from 'lodash';
import type { ISDFVUserInterface } from './sdfv_ui';
import { htmlSanitize } from './utils/sanitization';
import {
    ConditionalBlock,
    ControlFlowBlock,
    ControlFlowRegion,
    NestedSDFG,
    SDFG,
    SDFGElement,
    SDFGNode,
    State,
} from './renderer/sdfg/sdfg_elements';
import type { DagreGraph, SDFGRenderer } from './renderer/sdfg/sdfg_renderer';
import type { ISDFV } from './sdfv';
import { graphFindRecursive, traverseSDFGScopes } from './utils/sdfg/traversal';
import { SDFVSettings } from './utils/sdfv_settings';
import type { JsonSDFG } from './types';

type ChangeState = 'nodiff' | 'changed' | 'added' | 'removed';

interface localGraphDiffStackEntry {
    guid: string | null;
    htmlLabel: string;
    changeStatus: ChangeState;
    zoomToNodes: () => (SDFGNode | ControlFlowBlock)[];
    indents: number;
    children: (localGraphDiffStackEntry | null)[];
}

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
        protected leftRenderer?: SDFGRenderer,
        protected rightRenderer?: SDFGRenderer
    ) {
    }

    protected destroy(): void {
        this.leftRenderer?.destroy();
        this.rightRenderer?.destroy();
    }

    public static diff(graphA: SDFG, graphB: SDFG): DiffMap {
        if (!graphA.guid || !graphB.guid) {
            return {
                addedKeys: new Set(),
                removedKeys: new Set(),
                changedKeys: new Set(),
            };
        }

        const elementsDictA = new Map<string, SDFGElement>();
        const elementsDictB = new Map<string, SDFGElement>();

        function recursiveAddIds(
            graph: DagreGraph, dict: Map<string, SDFGElement>
        ) {
            for (const nid of graph.nodes()) {
                const node = graph.node(nid);
                if (node) {
                    dict.set(node.guid, node);
                    if ((node instanceof ControlFlowRegion ||
                        node instanceof State ||
                        node instanceof NestedSDFG) && node.graph) {
                        recursiveAddIds(node.graph, dict);
                    } else if (node instanceof ConditionalBlock) {
                        for (const [_, branch] of node.branches) {
                            if (branch.graph)
                                recursiveAddIds(branch.graph, dict);
                        }
                    }
                }
            }
            for (const eid of graph.edges()) {
                const edge = graph.edge(eid);
                if (edge)
                    dict.set(edge.guid, edge);
            }
        }

        elementsDictA.set(graphA.guid, graphA);
        recursiveAddIds(graphA.sdfgDagreGraph!, elementsDictA);
        elementsDictB.set(graphB.guid, graphB);
        recursiveAddIds(graphB.sdfgDagreGraph!, elementsDictB);

        const aKeys = new Set(elementsDictA.keys());
        const bKeys = new Set(elementsDictB.keys());

        const changedKeys = new Set<string>();
        const addedKeys = new Set([...bKeys].filter(x => !aKeys.has(x)));
        const removedKeys = new Set([...aKeys].filter(x => !bKeys.has(x)));
        const remainingKeys = new Set(
            [...aKeys].filter(x => !removedKeys.has(x))
        );

        for (const key of remainingKeys) {
            const elA = elementsDictA.get(key);
            const elB = elementsDictB.get(key);

            const attrA: Record<string, unknown> = {};
            for (const k in elA?.attributes()) {
                if (DIFF_IGNORE_ATTRIBUTES.includes(k))
                    continue;
                attrA[k] = elA.attributes()![k];
            }

            const attrB: Record<string, unknown> = {};
            for (const k in elB?.attributes()) {
                if (DIFF_IGNORE_ATTRIBUTES.includes(k))
                    continue;
                attrB[k] = elB.attributes()![k];
            }

            if (!_.isEqual(attrA, attrB))
                changedKeys.add(key);
        }

        return {
            addedKeys,
            removedKeys,
            changedKeys,
        };
    }

    public abstract get linkedUI(): ISDFVUserInterface;
    public abstract exitDiff(): void;

    protected sortChildrenByGUID(entry: localGraphDiffStackEntry): void {
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

    protected constructGraphOutlineBase(
        graph: DagreGraph
    ): (localGraphDiffStackEntry | null)[] {
        const elemClass = (elem: SDFGElement | JsonSDFG): ChangeState => {
            const guid = elem instanceof SDFGElement ?
                elem.guid : elem.attributes?.guid as string;
            if (!guid)
                return 'nodiff';
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
            if (!(node instanceof SDFGNode) &&
                !(node instanceof ControlFlowBlock))
                return false;

            // Skip exit nodes when scopes are known
            if (node.type.endsWith('Exit') &&
                (node.jsonData?.scope_entry ?? -1) as number >= 0) {
                stack.push(null);
                return true;
            }

            let isCollapsed = node.attributes()?.is_collapsed;
            isCollapsed = (isCollapsed === undefined) ? false : isCollapsed;
            let nodeType = node.type;

            // If a scope has children, remove the name "Entry" from the type
            if (node.type.endsWith('Entry') && node.parentStateId && node.id) {
                const state = (node.parentElem as State | undefined)?.jsonData;
                if (state?.scope_dict?.[node.id] !== undefined)
                    nodeType = nodeType.slice(0, -5);
            }

            // Create element
            const elemEntry = {
                guid: node.guid,
                htmlLabel: htmlSanitize`
                    ${nodeType} ${node.label}${isCollapsed ? ' (collapsed)' : ''}
                `,
                changeStatus: elemClass(node),
                zoomToNodes: () => {
                    const nodesToDisplay = [node];
                    if (node.type.endsWith('Entry') && node.parentElem &&
                        node.id) {
                        const state = (
                            node.parentElem as State | undefined
                        )?.jsonData;
                        if (state?.scope_dict?.[node.id] !== undefined) {
                            const scopeNodes = state.scope_dict[node.id] ?? [];
                            for (const subNodeId of scopeNodes) {
                                nodesToDisplay.push(parent.node(
                                    subNodeId.toString()
                                ) as SDFGNode);
                            }
                        }
                    }
                    return nodesToDisplay;
                },
                indents: 0,
                children: [],
            };
            stack.push(elemEntry);

            // If is collapsed, don't traverse further
            if (isCollapsed)
                return false;

            return true;
        }, (_node, _parent) => {
            // After scope ends, pop ourselves as the current element
            // and add to parent
            const elem = stack.pop();
            if (elem)
                stack[stack.length - 1]?.children.push(elem);
        });

        return stack;
    }

    public outline(): void {
        const infoContainer = this.linkedUI.infoContentContainer;
        if (!infoContainer)
            return;

        infoContainer.html('');
        if (!this.diffMap) {
            this.linkedUI.infoSetTitle('SDFG Diff Outline');
            infoContainer.text(
                'Error: No diff computed yet, please retry in a few seconds.'
            );
            this.linkedUI.infoShow();
            return;
        }

        const lSDFG = this.leftRenderer?.sdfg;
        const rSDFG = this.rightRenderer?.sdfg;
        const lGraph = this.leftRenderer?.graph;
        const rGraph = this.rightRenderer?.graph;
        if (!lGraph || !rGraph)
            return;

        this.linkedUI.infoSetTitle('SDFG Diff Outline');

        const container = $('<div>', {
            class: 'container-fluid',
        }).appendTo(infoContainer);

        // Entire SDFG
        const sdfgStatus = this.diffMap.changedKeys.has(
            (lSDFG?.attributes?.guid ?? '') as string
        ) ?  'changed' : 'nodiff';
        const leftSdfgLocalEntry: localGraphDiffStackEntry = {
            guid: (lSDFG?.attributes?.guid ?? '') as string,
            htmlLabel: htmlSanitize`
                <span class="material-symbols-outlined"
                      style="font-size: inherit">
                    filter_center_focus
                </span> SDFG ${lSDFG?.attributes?.name}
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
            guid: (rSDFG?.attributes?.guid ?? '') as string,
            htmlLabel: htmlSanitize`
                <span class="material-symbols-outlined"
                      style="font-size: inherit">
                    filter_center_focus
                </span> SDFG ${rSDFG?.attributes?.name}
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

            const changeStatColor = (entry: localGraphDiffStackEntry) => {
                switch (entry.changeStatus) {
                    case 'added':
                        return SDFVSettings.get<string>('diffAddedColor');
                    case 'removed':
                        return SDFVSettings.get<string>('diffRemovedColor');
                    case 'changed':
                        return SDFVSettings.get<string>('diffChangedColor');
                    default:
                        return '#cccccc';
                }
            };

            if (left && right) {
                const row = $('<div>', {
                    class: 'row diff-outline-entry',
                    css: {
                        'background-color': changeStatColor(left) + '80',
                    },
                    click: () => {
                        this.leftRenderer!.zoomToFit(left.zoomToNodes());
                        this.rightRenderer!.zoomToFit(right.zoomToNodes());
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
                    class: 'row diff-outline-entry',
                    css: {
                        'background-color': changeStatColor(left) + '80',
                    },
                    click: () => {
                        this.leftRenderer!.zoomToFit(left.zoomToNodes());
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
                    class: 'row diff-outline-entry',
                    css: {
                        'background-color': changeStatColor(right) + '80',
                    },
                    click: () => {
                        this.rightRenderer!.zoomToFit(right.zoomToNodes());
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
        while (lIdx < leftLinearized.length) {
            addElemEntry(leftLinearized[lIdx], undefined);
            lIdx++;
        }
        while (rIdx < rightLinearized.length) {
            addElemEntry(undefined, rightLinearized[rIdx]);
            rIdx++;
        }

        this.linkedUI.infoShow();
    }

    protected findInDiffGraphPredicate(
        predicate: (g: DagreGraph, el: SDFGElement) => boolean
    ): void {
        const lGraph = this.leftRenderer?.graph;
        const rGraph = this.rightRenderer?.graph;
        if (!lGraph || !rGraph)
            return;

        this.linkedUI.infoSetTitle('Search Results');

        const lResults: SDFGElement[] = [];
        graphFindRecursive(lGraph, predicate, lResults);
        const rResults: SDFGElement[] = [];
        graphFindRecursive(rGraph, predicate, rResults);

        // Zoom to bounding box of all results first
        if (lResults.length > 0)
            this.leftRenderer!.zoomToFit(lResults);
        if (rResults.length > 0)
            this.rightRenderer!.zoomToFit(rResults);

        const addedIDs = new Map<string, [SDFGElement, SDFGRenderer][]>();
        const mergedResults: string[] = [];
        for (const res of lResults) {
            const existing = addedIDs.get(res.guid);
            if (existing) {
                existing.push([res, this.leftRenderer!]);
            } else {
                const newEntry: [SDFGElement, SDFGRenderer][] =
                    [[res, this.leftRenderer!]];
                addedIDs.set(res.guid, newEntry);
                mergedResults.push(res.guid);
            }
        }
        for (const res of rResults) {
            const existing = addedIDs.get(res.guid);
            if (existing) {
                existing.push([res, this.rightRenderer!]);
            } else {
                const newEntry: [SDFGElement, SDFGRenderer][] =
                    [[res, this.rightRenderer!]];
                addedIDs.set(res.guid, newEntry);
                mergedResults.push(res.guid);
            }
        }

        // Show clickable results in sidebar
        const sidebar = this.linkedUI.infoContentContainer;
        if (sidebar) {
            sidebar.html('');
            for (const resId of mergedResults) {
                const res = addedIDs.get(resId);
                if (!res)
                    continue;

                let status: ChangeState = 'nodiff';
                const guid = res[0][0].guid;
                if (this.diffMap?.changedKeys.has(guid))
                    status = 'changed';
                else if (this.diffMap?.removedKeys.has(guid))
                    status = 'removed';
                else if (this.diffMap?.addedKeys.has(guid))
                    status = 'added';

                const d = $('<div>', {
                    class: `diff-outline-entry ${status}`,
                    html: htmlSanitize`${res[0][0].type} ${res[0][0].label}`,
                    click: () => {
                        for (const entry of res)
                            entry[1].zoomToFit([entry[0]]);
                    },
                });
                d.on('mouseenter', () => {
                    for (const entry of res) {
                        if (!entry[0].highlighted) {
                            entry[0].renderer.highlightRenderable(entry[0]);
                            entry[1].drawAsync();
                        }
                    }
                });
                d.on('mouseleave', () => {
                    for (const entry of res) {
                        if (entry[0].highlighted) {
                            entry[0].renderer.highlightRenderable(entry[0]);
                            entry[1].drawAsync();
                        }
                    }
                });

                sidebar.append(d);
            }
        }

        this.linkedUI.infoShow();
    }

}
