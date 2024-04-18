// Copyright 2019-2022 ETH Zurich and the DaCe authors. All rights reserved.

import { DagreGraph, Point2D, SimpleRect } from '../index';
import { SDFGRenderer } from '../renderer/renderer';
import {
    AccessNode,
    NestedSDFG,
    SDFGElement,
    SDFGNode
} from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { KELLY_COLORS } from '../utils/utils';
import { GenericSdfgOverlay, OverlayType } from './generic_sdfg_overlay';

// Available data storage types in the SDFG.
export enum StorageType {
    // Scope-default storage location
    Default = 'Default',
    // Local data on registers, stack, or equivalent memory
    Register = 'Register',
    // Host memory that can be DMA-accessed from accelerators
    CPU_Pinned = 'CPU_Pinned',
    // Host memory allocated on heap
    CPU_Heap = 'CPU_Heap',
    // Thread-local host memory
    CPU_ThreadLocal = 'CPU_ThreadLocal',
    // Global memory
    GPU_Global = 'GPU_Global',
    // Shared memory
    GPU_Shared = 'GPU_Shared',
    // Off-chip global memory (DRAM)
    FPGA_Global = 'FPGA_Global',
    // On-chip memory (bulk storage)
    FPGA_Local = 'FPGA_Local',
    // On-chip memory (fully partitioned registers)
    FPGA_Registers = 'FPGA_Registers',
    // Only accessible at constant indices
    FPGA_ShiftRegister = 'FPGA_ShiftRegister',
    // SVE register
    SVE_Register = 'SVE_Register',
}

// Available map schedule types in the SDFG.
enum ScheduleType {
    // Scope-default parallel schedule
    Default = 'Default',
    // Sequential code (single-thread)
    Sequential = 'Sequential',
    // MPI processes
    MPI = 'MPI',
    // OpenMP
    CPU_Multicore = 'CPU_Multicore',
    // Unrolled code
    Unrolled = 'Unrolled',
    // Arm SVE
    SVE_Map = 'SVE_Map',

    // Default scope schedule for GPU code.
    // Specializes to schedule GPU_Device and GPU_Global during inference.
    GPU_Default = 'GPU_Default',
    // Kernel
    GPU_Device = 'GPU_Device',
    // Thread-block code
    GPU_ThreadBlock = 'GPU_ThreadBlock',
    // Allows rescheduling work within a block
    GPU_ThreadBlock_Dynamic = 'GPU_ThreadBlock_Dynamic',
    GPU_Persistent = 'GPU_Persistent',
    FPGA_Device = 'FPGA_Device',
}

// Maps from ScheduleType to default StorageType.
const SCOPEDEFAULT_STORAGE =
    new Map<(StorageType | ScheduleType | null | undefined), StorageType>([
        [StorageType.Default, StorageType.Default],
        [null, StorageType.CPU_Heap],
        [undefined, StorageType.CPU_Heap],
        [ScheduleType.Sequential, StorageType.Register],
        [ScheduleType.MPI, StorageType.CPU_Heap],
        [ScheduleType.CPU_Multicore, StorageType.Register],
        [ScheduleType.GPU_Default, StorageType.GPU_Global],
        [ScheduleType.GPU_Persistent, StorageType.GPU_Global],
        [ScheduleType.GPU_Device, StorageType.GPU_Shared],
        [ScheduleType.GPU_ThreadBlock, StorageType.Register],
        [ScheduleType.GPU_ThreadBlock_Dynamic, StorageType.Register],
        [ScheduleType.FPGA_Device, StorageType.FPGA_Global],
        [ScheduleType.SVE_Map, StorageType.CPU_Heap]
    ]);

// Maps from ScheduleType to default ScheduleType for sub-scopes.
const SCOPEDEFAULT_SCHEDULE =
    new Map<(ScheduleType | null | undefined), ScheduleType>([
        [ScheduleType.Default, ScheduleType.Default],
        [null, ScheduleType.CPU_Multicore],
        [undefined, ScheduleType.CPU_Multicore],
        [ScheduleType.Sequential, ScheduleType.Sequential],
        [ScheduleType.MPI, ScheduleType.CPU_Multicore],
        [ScheduleType.CPU_Multicore, ScheduleType.Sequential],
        [ScheduleType.Unrolled, ScheduleType.CPU_Multicore],
        [ScheduleType.GPU_Default, ScheduleType.GPU_Device],
        [ScheduleType.GPU_Persistent, ScheduleType.GPU_Device],
        [ScheduleType.GPU_Device, ScheduleType.GPU_ThreadBlock],
        [ScheduleType.GPU_ThreadBlock, ScheduleType.Sequential],
        [ScheduleType.GPU_ThreadBlock_Dynamic, ScheduleType.Sequential],
        [ScheduleType.FPGA_Device, ScheduleType.FPGA_Device],
        [ScheduleType.SVE_Map, ScheduleType.Sequential]
    ]);

const STYPE_COLOR = new Map<StorageType, number>([
    [StorageType.Default, KELLY_COLORS[3]],

    [StorageType.Register, KELLY_COLORS[0]],

    [StorageType.CPU_Pinned, KELLY_COLORS[1]],
    [StorageType.CPU_Heap, KELLY_COLORS[2]],
    [StorageType.CPU_ThreadLocal, KELLY_COLORS[4]],

    [StorageType.GPU_Global, KELLY_COLORS[5]],
    [StorageType.GPU_Shared, KELLY_COLORS[8]],

    [StorageType.FPGA_Global, KELLY_COLORS[9]],
    [StorageType.FPGA_Local, KELLY_COLORS[10]],
    [StorageType.FPGA_Registers, KELLY_COLORS[11]],
    [StorageType.FPGA_ShiftRegister, KELLY_COLORS[12]],

    [StorageType.SVE_Register, KELLY_COLORS[19]],
]);

export class MemoryLocationOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = MemoryLocationOverlay;

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    public refresh(): void {
        this.renderer.draw_async();
    }

    public static recursiveFindScopeSchedule(
        node: any, parentId?: number, sdfg?: any
    ): ScheduleType | undefined {
        let scopeNode;
        if (node instanceof SDFGNode) {
            if (node.data?.node?.scope_entry !== undefined &&
                node.parent_id !== null) {
                scopeNode = node.parentElem?.data.state.nodes[
                    node.data.node.scope_entry
                ];
                parentId = node.parent_id;
                sdfg = node.sdfg;
            }
        } else if (node.scope_entry !== undefined &&
            parentId !== undefined && sdfg !== undefined) {
            scopeNode = sdfg.nodes[parentId].nodes[node.scope_entry];
        }

        const schedule = scopeNode?.attributes?.schedule;
        if (schedule) {
            if (schedule === ScheduleType.Default) {
                const parentSchedule = this.recursiveFindScopeSchedule(
                    scopeNode, parentId, sdfg
                );
                return SCOPEDEFAULT_SCHEDULE.get(parentSchedule);
            } else {
                return schedule;
            }
        }
        return undefined;
    }

    public static getStorageType(node: AccessNode): {
        type: StorageType,
        originalType: StorageType | null,
    } {
        const sdfgArray = node.sdfg.attributes._arrays[node.attributes().data];

        let storageType = sdfgArray?.attributes?.storage;
        let originalType: StorageType | null = null;
        if (storageType) {
            if (storageType === StorageType.Default) {
                const schedule =
                    MemoryLocationOverlay.recursiveFindScopeSchedule(node);
                const derivedStorageType = SCOPEDEFAULT_STORAGE.get(schedule);
                if (derivedStorageType) {
                    originalType = storageType;
                    storageType = derivedStorageType;
                }
            }
        }
        return {
            type: storageType,
            originalType: originalType,
        };
    }

    public shadeNode(node: AccessNode, ctx: CanvasRenderingContext2D): void {
        const storageType = MemoryLocationOverlay.getStorageType(node);
        const mousepos = this.renderer.get_mousepos();
        if (mousepos && node.intersect(mousepos.x, mousepos.y)) {
            this.renderer.set_tooltip(() => {
                const ttContainer = this.renderer.get_tooltip_container();
                if (ttContainer) {
                    if (storageType.originalType)
                        ttContainer.innerHTML = 'Location: ' +
                            storageType.originalType + ' &rarr; ' +
                            storageType.type;
                    else
                        ttContainer.innerHTML = 'Location: ' + storageType.type;
                }
            });
        }

        const color = STYPE_COLOR.get(storageType.type)?.toString(16);
        if (color)
            node.shade(this.renderer, ctx, '#' + color);
    }

    public recursivelyShadeSdfg(
        graph: DagreGraph,
        ctx: CanvasRenderingContext2D,
        ppp: number,
        visibleRect: SimpleRect
    ): void {
        // First go over visible states, skipping invisible ones. We traverse
        // inside to shade memory nodes wherever applicable.
        graph.nodes().forEach(v => {
            const state = graph.node(v);

            // If the node's invisible, we skip it.
            if ((ctx as any).lod && !state.intersect(
                visibleRect.x, visibleRect.y,
                visibleRect.w, visibleRect.h
            ))
                return;

            if (((ctx as any).lod && (ppp >= SDFV.STATE_LOD ||
                state.width / ppp <= SDFV.STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                // The state is collapsed or invisible, so we don't need to
                // traverse its insides.
                return;
            } else {
                const stateGraph = state.data.graph;
                if (stateGraph) {
                    stateGraph.nodes().forEach((v: any) => {
                        const node = stateGraph.node(v);

                        // Skip the node if it's not visible.
                        if ((ctx as any).lod && !node.intersect(visibleRect.x,
                            visibleRect.y, visibleRect.w, visibleRect.h))
                            return;

                        if (node instanceof NestedSDFG &&
                            node.attributes().sdfg &&
                            node.attributes().sdfg.type !== 'SDFGShell') {
                            this.recursivelyShadeSdfg(
                                node.data.graph, ctx, ppp, visibleRect
                            );
                        } else if (node instanceof AccessNode) {
                            this.shadeNode(node, ctx);
                        }
                    });
                }
            }
        });
    }

    public draw(): void {
        const graph = this.renderer.get_graph();
        const ppp = this.renderer.get_canvas_manager()?.points_per_pixel();
        const context = this.renderer.get_context();
        const visibleRect = this.renderer.get_visible_rect();
        if (graph && ppp !== undefined && context && visibleRect)
            this.recursivelyShadeSdfg(graph, context, ppp, visibleRect);
    }

    public on_mouse_event(
        _type: string,
        _ev: MouseEvent,
        _mousepos: Point2D,
        _elements: SDFGElement[],
        _foreground_elem: SDFGElement | undefined,
        _ends_drag: boolean
    ): boolean {
        return false;
    }

}
