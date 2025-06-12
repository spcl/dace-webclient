// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type {
    SDFGRenderer,
} from '../renderer/sdfg/sdfg_renderer';
import {
    AccessNode,
    SDFGNode,
    State,
} from '../renderer/sdfg/sdfg_elements';
import {
    JsonSDFG,
    JsonSDFGNode,
    JsonSDFGState,
    OverlayType,
} from '../types';
import { KELLY_COLORS } from '../utils/utils';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';

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
        [ScheduleType.SVE_Map, StorageType.CPU_Heap],
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
        [ScheduleType.SVE_Map, ScheduleType.Sequential],
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
        this.renderer.drawAsync();
    }

    public static recursiveFindScopeSchedule(
        node: SDFGNode | JsonSDFGNode, parentId?: number, sdfg?: JsonSDFG
    ): ScheduleType | undefined {
        let scopeNode;
        if (node instanceof SDFGNode) {
            if (node.jsonData?.scope_entry !== undefined &&
                node.parentStateId !== undefined) {
                scopeNode = (
                    node.parentElem as State | undefined
                )?.jsonData?.nodes[+node.jsonData.scope_entry];
                parentId = node.parentStateId;
                sdfg = node.sdfg;
            }
        } else if (node.scope_entry !== undefined &&
            parentId !== undefined && sdfg !== undefined) {
            const state = sdfg.nodes[parentId] as JsonSDFGState;
            scopeNode = state.nodes[+node.scope_entry];
        }

        const schedule = scopeNode?.attributes?.schedule as
            ScheduleType | undefined;
        if (schedule && scopeNode) {
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
        originalType?: StorageType,
    } {
        const sdfg = node.sdfg;
        const data = node.attributes()?.data as string | undefined;
        if (!data) {
            return {
                type: StorageType.Default,
                originalType: undefined,
            };
        }
        const sdfgArray = sdfg.attributes?._arrays[data];

        let storageType = sdfgArray?.attributes?.storage;
        let originalType: StorageType | undefined = undefined;

        storageType ??= StorageType.Default;

        if (storageType === StorageType.Default.toString()) {
            const schedule =
                MemoryLocationOverlay.recursiveFindScopeSchedule(node);
            const derivedStorageType = SCOPEDEFAULT_STORAGE.get(schedule);
            if (derivedStorageType) {
                originalType = storageType as StorageType;
                storageType = derivedStorageType;
            }
        }
        return {
            type: storageType as StorageType,
            originalType: originalType,
        };
    }

    protected shadeNode(node: AccessNode, ctx: CanvasRenderingContext2D): void {
        const storageType = MemoryLocationOverlay.getStorageType(node);
        const mousepos = this.renderer.getMousePos();
        if (mousepos && node.intersect(mousepos.x, mousepos.y)) {
            this.renderer.showTooltip(
                mousepos.x, mousepos.y,
                'Location: ' + (storageType.originalType ? (
                    storageType.originalType.toString() + ' &rarr; ' +
                    storageType.type
                ) : storageType.type)
            );
        }

        const color = STYPE_COLOR.get(storageType.type)?.toString(16);
        if (color)
            node.shade(this.renderer, ctx, '#' + color);
    }

    public draw(): void {
        this.shadeSDFG((elem) => {
            return elem instanceof AccessNode;
        });
    }

}
