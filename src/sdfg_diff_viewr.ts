// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import {
    DagreGraph,
    JsonSDFG,
    JsonSDFGControlFlowRegion,
    JsonSDFGEdge,
    JsonSDFGElement,
    JsonSDFGState,
    Point2D,
    SDFG,
    SDFGElement,
    SDFV,
    WebSDFV,
} from '.';
import { DiffOverlay } from './overlays/diff_overlay';
import { SDFGRenderer } from './renderer/renderer';
import _ from 'lodash';

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

export abstract class SDFGDiffViewer {

    protected syncMovement: boolean = true;

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

        return {
            addedKeys,
            removedKeys,
            changedKeys,
        };
    }

    public onMouseEvent(
        evtype: string,
        _event: Event,
        _mousepos: Point2D,
        _elements: {
            states: any[],
            nodes: any[],
            connectors: any[],
            edges: any[],
            isedges: any[],
        },
        renderer: SDFGRenderer,
        selected_elements: SDFGElement[],
        ends_pan: boolean
    ): boolean {
        // If the click ends a pan, we don't want to open the sidebar.
        /*
        if (evtype === 'click' && !ends_pan) {
            let element;
            if (selected_elements.length === 0)
                element = new SDFG(renderer.get_sdfg());
            else if (selected_elements.length === 1)
                element = selected_elements[0];
            else
                element = null;

            if (element !== null) {
                this.sidebar_set_title(
                    element.type() + ' ' + element.label()
                );
                this.fill_info(element);
            } else {
                this.close_menu();
                this.sidebar_set_title('Multiple elements selected');
            }
            this.sidebar_show();
        }
            */
        return false;
    }

    public abstract exitDiff(): void;
    public abstract outline(): void;
    public abstract fill_info(elem: SDFGElement | DagreGraph | null): void;

}

export class WebSDFGDiffViewer extends SDFGDiffViewer {

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
    }

    private deregisterEventListeners(): void {
        $(document).off('.sdfv-diff');
    }

    public exitDiff(): void {
        // TODO: loading
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

        const leftRenderer = new SDFGRenderer(graphA, leftContainer);
        const rightRenderer = new SDFGRenderer(graphB, rightContainer);

        const viewer = new WebSDFGDiffViewer(leftRenderer, rightRenderer);
        viewer.registerEventListeners();
        viewer.initUI();

        leftRenderer.registerExternalMouseHandler(viewer.onMouseEvent);
        rightRenderer.registerExternalMouseHandler(viewer.onMouseEvent);

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

        return viewer;
    }

    public outline(): void {
        // TODO:
        console.log('outline');
    }

    public fill_info(elem: SDFGElement | DagreGraph | null): void {
        // TODO: implement
        console.log(elem);
    }

}
