import { DagreSDFG, Point2D, SimpleRect } from '../index';
import { SDFGRenderer } from '../renderer/renderer';
import {
    AccessNode,
    NestedSDFG,
    SDFGElement
} from '../renderer/renderer_elements';
import { SDFV } from '../sdfv';
import { KELLY_COLORS } from '../utils/utils';
import { GenericSdfgOverlay } from './generic_sdfg_overlay';

// Available data storage types in the SDFG.
enum StorageType {
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
    new Map<(StorageType | ScheduleType | null), StorageType>([
        [StorageType.Default, StorageType.Default],
        [null, StorageType.CPU_Heap],
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
const SCOPEDEFAULT_SCHEDULE = new Map<(ScheduleType | null), ScheduleType>([
    [ScheduleType.Default, ScheduleType.Default],
    [null, ScheduleType.CPU_Multicore],
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

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    public refresh(): void {
        this.renderer.draw_async();
    }

    public shade_node(node: AccessNode, ctx: CanvasRenderingContext2D): void {
        const sdfg_array = node.sdfg.attributes._arrays[node.attributes().data];

        const storage_type = sdfg_array?.attributes?.storage;
        if (storage_type) {
            // TODO: if the storage type is Default, derive the final one from
            // the surrounding scope.

            const mousepos = this.renderer.get_mousepos();
            if (mousepos && node.intersect(mousepos.x, mousepos.y)) {
                this.renderer.set_tooltip(() => {
                    const tt_cont = this.renderer.get_tooltip_container();
                    if (tt_cont)
                        tt_cont.innerText = 'Location: ' + storage_type;
                });
            }

            const color = STYPE_COLOR.get(storage_type)?.toString(16);
            if (color)
                node.shade(this.renderer, ctx, '#' + color);
        }
    }

    public recursively_shade_sdfg(
        graph: DagreSDFG,
        ctx: CanvasRenderingContext2D,
        ppp: number,
        visible_rect: SimpleRect
    ): void {
        // First go over visible states, skipping invisible ones. We traverse
        // inside to shade memory nodes wherever applicable.
        graph.nodes().forEach(v => {
            const state = graph.node(v);

            // If the node's invisible, we skip it.
            if ((ctx as any).lod && !state.intersect(
                visible_rect.x, visible_rect.y,
                visible_rect.w, visible_rect.h
            ))
                return;

            if (((ctx as any).lod && (ppp >= SDFV.STATE_LOD ||
                state.width / ppp <= SDFV.STATE_LOD)) ||
                state.data.state.attributes.is_collapsed) {
                // The state is collapsed or invisible, so we don't need to
                // traverse its insides.
                return;
            } else {
                const state_graph = state.data.graph;
                if (state_graph) {
                    state_graph.nodes().forEach((v: any) => {
                        const node = state_graph.node(v);

                        // Skip the node if it's not visible.
                        if ((ctx as any).lod && !node.intersect(visible_rect.x,
                            visible_rect.y, visible_rect.w, visible_rect.h))
                            return;

                        if (node instanceof NestedSDFG) {
                            this.recursively_shade_sdfg(
                                node.data.graph, ctx, ppp, visible_rect
                            );
                        } else if (node instanceof AccessNode) {
                            this.shade_node(node, ctx);
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
        const visible_rect = this.renderer.get_visible_rect();
        if (graph && ppp !== undefined && context && visible_rect)
            this.recursively_shade_sdfg(graph, context, ppp, visible_rect);
    }

    public on_mouse_event(
        type: string,
        _ev: MouseEvent,
        _mousepos: Point2D,
        _elements: SDFGElement[],
        foreground_elem: SDFGElement | undefined,
        ends_drag: boolean
    ): boolean {
        return false;
    }

}
