import {
    SDFGNode,
    SDFGElement,
    Edge,
    ControlFlowBlock,
} from '../renderer/sdfg/sdfg_elements';
import { SDFGRenderer } from '../renderer/sdfg/sdfg_renderer';
import $ from 'jquery';
import { OverlayType } from '../types';
import { GenericSdfgOverlay } from './common/generic_sdfg_overlay';
import { KELLY_COLORS } from 'rendure/dist/utils/colors';

export class AllocationOverlay extends GenericSdfgOverlay {

    public static readonly type: OverlayType = OverlayType.NODE;
    public readonly olClass: typeof GenericSdfgOverlay = AllocationOverlay;

    private AllocationMap: Record<string, string[]> = {};
    private AllocationMapReversed: Record<string, string[]> = {};
    private FocusedNodes: string[] = [];

    //maps from AccessNodes uid to coloring in overlay
    private colorMap: Record<string, number> = {};

    public constructor(renderer: SDFGRenderer) {
        super(renderer);

        this.refresh();
    }

    public refresh(): void {
        this.renderer.drawAsync();
    }

    public setAllocationMap(map: Record<string, string[]>) {
        this.AllocationMap = map;
        this.AllocationMapReversed = {};
        for (const [dataContainer, nodes] of Object.entries(map)) {
            for (const node of nodes) {
                if (!Object.keys(this.AllocationMapReversed).includes(node))
                    this.AllocationMapReversed[node] = [];
                this.AllocationMapReversed[node].push(dataContainer)
            }
        }
    }

    private createLegendItem(
        color: string,
        label: string,
        OnRemove: (id: string) => void
    ) {
        const item = $('<div>', {
            class: 'legend-item',
            css: {
                'display': 'flex',
                'align-items': 'center',
            }
        });

        $('<span>', {
            class: 'legend-circle',
            css: {
                'width': '16px',
                'height': '16px',
                'border-radius': '50%',
                'background-color': color,
            }
        }).appendTo(item);

        $('<span>', {
            class: 'legend-label',
            text: label
        }).appendTo(item);

        $('<button>', {
            text: 'x',
            css: {
                'cursor': 'pointer',
                'border': 'none',
                'border-radius': '4px',
                'font-size': '16px'
            },
            click: function () {
                item.remove();
                OnRemove(label)
            }
        }).appendTo(item)
        return item;
    }

    public setFocusedNode(node: any) {
        if (typeof node === 'string' && !this.FocusedNodes.includes(node)) {
            // add node to allocation legend
            if(this.renderer.ui?.allocationLegend !== undefined) {
                this.createLegendItem(
                    '#' + KELLY_COLORS[this.FocusedNodes.length].toString(16),
                    node,
                    (id) => {
                        const index = this.FocusedNodes.indexOf(id);
                        if(index > -1)
                            this.FocusedNodes.splice(index, 1);
                        this.refresh()
                    }
                ).appendTo(this.renderer.ui.allocationLegend)
            }
            this.FocusedNodes.push(node);

            this.refresh();
        }
    }

    public hasKey(node: any) {
        return typeof node === 'string' &&
            Object.keys(this.AllocationMap).includes(node);
    }



    public shadeElem(elem: SDFGElement): void {
        if (
            Object.keys(this.AllocationMapReversed).includes(elem.guid) &&
            this.AllocationMapReversed[elem.guid].filter(
                dc => this.FocusedNodes.includes(dc)
            ).length >= 2 &&
            this.AllocationMapReversed[elem.guid].length > 1
        ) {
            elem.shade('#FF0000');
        } else {
            for (const [index, dataContainer] of this.FocusedNodes.entries()) {
                const color = KELLY_COLORS[index];
                if (elem.guid === dataContainer) {
                    const factor = 0.6;
                    const darkerColor =
                        (
                            (((color >> 16) & 0xFF) * factor) << 16 |
                            (((color >> 8) & 0xFF) * factor) << 8 |
                            ((color & 0xFF) * factor)
                        ) >>> 0;
                    elem.shade('#' + darkerColor.toString(16));
                } else if (
                    Object.keys(this.AllocationMap).includes(dataContainer)
                ) {
                    if (this.AllocationMap[dataContainer].includes(elem.guid))
                        elem.shade('#' + KELLY_COLORS[index].toString(16));
                }
            }
        }
    }

    protected shadeBlock(block: ControlFlowBlock, ..._args: any[]): void {
        this.shadeElem(block);
    }

    protected shadeNode(node: SDFGNode, ..._args: any[]): void {
        this.shadeElem(node);
    }

    protected shadeEdge(edge: Edge, ..._args: any[]): void {
        this.shadeElem(edge);
    }

    public draw(): void {
        this.shadeSDFG();
    }
}
