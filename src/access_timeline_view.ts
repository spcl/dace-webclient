// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../scss/access_timeline.scss';
import {
    DataSubset,
    JsonSDFG,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGState,
} from './types';
import {
    checkCompatLoad,
    parseSDFG,
    readOrDecompress,
} from './utils/sdfg/json_serializer';
import {
    AccessTimelineRenderer,
} from './renderer/access_timeline/access_timeline_renderer';


export interface MemoryTimelineScope {
    label: string;
    scope: string;
    children: MemoryTimelineScope[];
    start_time: number;
    end_time: number;
}

export interface MemoryEvent {
    type: 'DataAccessEvent' | 'AllocationEvent' | 'DeallocationEvent';
}

export interface DataAccessEvent extends MemoryEvent {
    type: 'DataAccessEvent';
    alloc_name: string;
    data: string;
    container_sdfg: number;
    sdfg: number;
    block?: string;
    anode?: string;
    edge?: string;
    subset: DataSubset;
    mode: 'write' | 'read';
    conditional: boolean;
}

export interface AllocationEvent extends MemoryEvent {
    type: 'AllocationEvent';
    data: [string, number][];
    sdfg: number;
    scope: string;
    conditional: boolean;
}

export interface DeallocationEvent extends MemoryEvent {
    type: 'DeallocationEvent';
    data: string[];
    sdfg: number;
    scope: string;
    conditional: boolean;
}

export type InputOutputMap = Record<('inout' | 'in' | 'out'),
    (string | { type: 'regex', expr: string })[]>;

export class AccessTimelineView {

    private readonly renderer: AccessTimelineRenderer;

    public constructor() {
        $(document).on(
            'change.sdfv', '#sdfg-file-input',
            this.loadSDFG.bind(this)
        );
        $(document).on(
            'change.sdfv', '#inputs-file-input',
            this.loadInputsOutputsFile.bind(this)
        );
        $(document).on(
            'change.sdfv', '#sdfg-access-timeline-file-input',
            this.loadAccessTimeline.bind(this)
        );

        const container = $('#timeline-contents');
        this.renderer = new AccessTimelineRenderer(container);

        const saveAsPDFFunc = (full: boolean) => {
            let prefix = '';
            if (this.renderer.sdfg?.attributes && Object.hasOwn(
                this.renderer.sdfg.attributes, 'name'
            )) {
                prefix = this.renderer.sdfg.attributes.name as string;
                prefix += '-';
            }
            const filename = prefix + 'timeline.pdf';
            this.renderer.saveAsPDF(filename, full);
        };

        $('#save-access-timeline-as-pdf-btn').on(
            'click', () => {
                saveAsPDFFunc(true);
            }
        );
        $('#save-access-timeline-view-as-pdf-btn').on(
            'click', () => {
                saveAsPDFFunc(false);
            }
        );
    }

    private recursivelyRegisterSDFGs(cfg: JsonSDFGControlFlowRegion): void {
        if (cfg.type === 'SDFG')
            this.renderer.sdfgList.set(cfg.cfg_list_id, cfg as JsonSDFG);

        for (const node of cfg.nodes) {
            if (node.type === 'SDFGState') {
                for (const nd of (node as JsonSDFGState).nodes) {
                    if (nd.type === 'NestedSDFG') {
                        const nsdfg = nd.attributes?.sdfg;
                        if (nsdfg)
                            this.recursivelyRegisterSDFGs(nsdfg);
                    }
                }
            } else if (node.type === 'ConditionalBlock') {
                for (const brn of (node as JsonSDFGConditionalBlock).branches)
                    this.recursivelyRegisterSDFGs(brn[1]);
            } else if (Object.hasOwn(node, 'nodes')) {
                this.recursivelyRegisterSDFGs(
                    node as JsonSDFGControlFlowRegion
                );
            }
        }
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

            if (result) {
                this.renderer.sdfg = checkCompatLoad(parseSDFG(result));
                this.recursivelyRegisterSDFGs(this.renderer.sdfg);
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    public loadInputsOutputsFile(changeEvent: JQuery.TriggeredEvent): void {
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
                const packedResult = readOrDecompress(result);
                this.renderer.inputOutputDefinitions = JSON.parse(
                    packedResult[0]
                ) as InputOutputMap;
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    public loadAccessTimeline(changeEvent: JQuery.TriggeredEvent): void {
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
                const packedResult = readOrDecompress(result);
                const data = JSON.parse(
                    packedResult[0]
                ) as Record<string, unknown>;
                const timeline = data.events as MemoryEvent[] | undefined;
                const scopes = data.scopes as MemoryTimelineScope[] | undefined;
                if (timeline && scopes)
                    this.renderer.setTimeline(timeline, scopes);
                else
                    console.error('Failed to load statistics');
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

}

$(() => {
    new AccessTimelineView();
});
