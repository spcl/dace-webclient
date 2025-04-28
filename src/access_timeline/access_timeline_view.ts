// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import 'bootstrap';

import '../../scss/access_timeline.scss';
import {
    DataSubset,
    JsonSDFG,
    JsonSDFGConditionalBlock,
    JsonSDFGControlFlowRegion,
    JsonSDFGState,
} from '../types';
import {
    checkCompatLoad,
    parse_sdfg,
    read_or_decompress,
} from '../utils/sdfg/json_serializer';
import {
    TimelineChart,
} from './renderer_elements';
import { AccessTimelineRenderer } from './access_timeline_renderer';


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

    public sdfg?: JsonSDFG;
    public inputOutputDefinitions?: InputOutputMap;
    public sdfg_list: Map<number, JsonSDFG> = new Map();

    private timeline: MemoryEvent[] | null = null;
    private scopes: MemoryTimelineScope[] | null = null;
    private chart?: TimelineChart;

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

        this.renderer = new AccessTimelineRenderer();

        $('#save-access-timeline-as-pdf-btn').on(
            'click', () => { this.renderer.saveAsPDF(true) }
        );
        $('#save-access-timeline-view-as-pdf-btn').on(
            'click', () => { this.renderer.saveAsPDF(false) }
        );
    }

    private recursivelyRegisterSDFGs(cfg: JsonSDFGControlFlowRegion): void {
        if (cfg.type === 'SDFG')
            this.sdfg_list.set(cfg.cfg_list_id, cfg as JsonSDFG);

        for (const node of cfg.nodes) {
            if (node.type === 'SDFGState') {
                for (const nd of (node as JsonSDFGState).nodes) {
                    if (nd.type === 'NestedSDFG') {
                        this.recursivelyRegisterSDFGs(
                            (nd as any).attributes.sdfg
                        );
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

    public loadSDFG(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const file = changeEvent.target.files[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                this.sdfg = checkCompatLoad(parse_sdfg(result));
                if (this.sdfg)
                    this.recursivelyRegisterSDFGs(this.sdfg);
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    public loadInputsOutputsFile(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const file = changeEvent.target.files[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                const packedResult = read_or_decompress(result);
                this.inputOutputDefinitions = JSON.parse(packedResult[0]);
            }
        };
        fileReader.readAsArrayBuffer(file);
    }

    public loadAccessTimeline(changeEvent: any): void {
        if (changeEvent.target.files.length < 1)
            return;
        const file = changeEvent.target.files[0];
        if (!file)
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const result = e.target?.result;

            if (result) {
                const packedResult = read_or_decompress(result);
                const data = JSON.parse(packedResult[0]);
                const timeline = data['events'];
                const scopes = data['scopes'];
                if (this.timeline && this.scopes)
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

