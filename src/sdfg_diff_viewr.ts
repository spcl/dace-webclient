// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import {
    DagreGraph,
    JsonSDFG,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGElement,
    JsonSDFGState,
    SDFGElement,
} from '.';
import { DiffOverlay } from './overlays/diff_overlay';
import { SDFGRenderer } from './renderer/renderer';
import * as _ from 'lodash';

const DIFF_IGNORE_ATTRIBUTES = [
    'guid', 'hash', 'sdfg', 'orig_sdfg', 'transformation_hist', 'layout',
];

export interface DiffMap {
    addedKeys: Set<string>;
    removedKeys: Set<string>;
    changedKeys: Set<string>;
}

export class SDFGDiffViewer {

    protected leftRenderer?: SDFGRenderer = undefined;
    protected rightRenderer?: SDFGRenderer = undefined;

    protected syncMovement: boolean = true;

    public constructor() {
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

        return {
            addedKeys,
            removedKeys,
            changedKeys,
        };
    }

    public fill_info(elem: SDFGElement | DagreGraph | null): void {
        // TODO: Implement
    }

    public outline(renderer: SDFGRenderer, sdfg: DagreGraph): void {
        // TODO: Implement
    }

    public onMouseEvent(): boolean {
        return false;
    }

    public static init(graphA: JsonSDFG, graphB: JsonSDFG): SDFGDiffViewer {
        const viewer = new SDFGDiffViewer();

        const leftContainer = document.getElementById('diff-contents-A');
        const rightContainer = document.getElementById('diff-contents-B');
        if (!leftContainer || !rightContainer)
            throw Error('Failed to find diff renderer containers');

        const leftRenderer = new SDFGRenderer(
            viewer, graphA, leftContainer, viewer.onMouseEvent
        );
        const rightRenderer = new SDFGRenderer(
            viewer, graphB, rightContainer, viewer.onMouseEvent
        );

        viewer.diff(graphA, graphB).then(diff => {
            const leftOverlay = new DiffOverlay(leftRenderer, diff);
            const rightOverlay = new DiffOverlay(rightRenderer, diff);
            leftRenderer.get_overlay_manager().register_overlay_instance(
                leftOverlay
            );
            rightRenderer.get_overlay_manager().register_overlay_instance(
                rightOverlay
            );
        });

        return viewer;
    }

}
