// Copyright 2019-2024 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import {
    AccessNode,
    Edge,
    Memlet,
    NestedSDFG,
    SDFG,
    SDFGElement,
} from './renderer/renderer_elements';
import type { DagreGraph, SDFGRenderer } from './renderer/renderer';
import { WebSDFV } from './sdfv';
import { sdfg_property_to_string } from './utils/sdfg/display';

export interface ISDFVUserInterface {
    get infoContentContainer(): JQuery<HTMLElement>;
    init(): void;
    infoClear(hide?: boolean): void;
    infoHide(): void;
    infoShow(overrideHidden?: boolean): void;
    infoSetTitle(title: string): void;
    disableInfoClear(): void;
    enableInfoClear(): void;
    showElementInfo(
        elem: SDFGElement | DagreGraph | null, renderer: SDFGRenderer
    ): void;
}

export class SDFVWebUI implements ISDFVUserInterface {

    private static readonly INSTANCE: SDFVWebUI = new SDFVWebUI();

    private constructor() {
    }

    public static getInstance(): SDFVWebUI {
        return this.INSTANCE;
    }

    public get infoContentContainer(): JQuery<HTMLElement> {
        return $('#sidebar-contents');
    }

    private initInfo(): void {
        const right = document.getElementById('sidebar');
        const bar = document.getElementById('dragbar');

        const drag = (e: MouseEvent) => {
            if ((document as any).selection)
                (document as any).selection.empty();
            else
                window.getSelection()?.removeAllRanges();

            if (right) {
                right.style.width = Math.max(
                    ((e.view ? e.view.innerWidth - e.pageX : 0)), 20
                ) + 'px';
            }
        };

        if (bar) {
            bar.addEventListener('mousedown', () => {
                document.addEventListener('mousemove', drag);
                document.addEventListener('mouseup', () => {
                    document.removeEventListener('mousemove', drag);
                });
            });
        }
    }

    public init(): void {
        $(document).on(
            'click.sdfv-webui', '#menuclose', () => {
                this.infoClear();
            }
        );

        this.initInfo();

        // Set up any external interaction mode buttons that may override the
        // renderer.
        const pan_btn = document.getElementById('pan-btn');
        const move_btn = document.getElementById('move-btn');
        const select_btn = document.getElementById('select-btn');
        const add_btns: HTMLElement[] = [];
        add_btns.push(document.getElementById('elem_map')!);
        add_btns.push(document.getElementById('elem_consume')!);
        add_btns.push(document.getElementById('elem_tasklet')!);
        add_btns.push(document.getElementById('elem_nested_sdfg')!);
        add_btns.push(document.getElementById('elem_access_node')!);
        add_btns.push(document.getElementById('elem_stream')!);
        add_btns.push(document.getElementById('elem_state')!);
        if (pan_btn) {
            WebSDFV.getInstance().setModeButtons({
                pan: pan_btn,
                move: move_btn,
                select: select_btn,
                add_btns: add_btns,
            });
        }
    }

    public infoClear(hide: boolean = true): void {
        this.infoContentContainer.html('');
        if (hide)
            this.infoHide();
    }

    public infoHide(): void {
        $('#sidebar').css('display', 'none');
    }

    public infoShow(_overrideHidden?: boolean): void {
        // Open sidebar if closed
        $('#sidebar').css('display', 'flex');
    }

    public infoSetTitle(title: string): void {
        $('#sidebar-header')?.text(title);
    }

    public disableInfoClear(): void {
        $('#menuclose').hide();
    }

    public enableInfoClear(): void {
        $('#menuclose').show();
    }

    public showElementInfo(
        elem: SDFGElement | DagreGraph | null, renderer: SDFGRenderer
    ): void {
        const contents = SDFVWebUI.getInstance().infoContentContainer;
        if (!contents || !elem || !(elem instanceof SDFGElement))
            return;
        this.infoSetTitle(elem.type() + ' ' + elem.label());

        contents.html('');

        if (elem instanceof Memlet) {
            contents.append($('<p>', {
                html: 'Connectors: ' + elem.src_connector + ' &rarr; ' +
                    elem.dst_connector,
            }));
        }
        contents.append($('<hr>'));

        if (elem instanceof Edge) {
            const btnContainer = $('<div>', {
                class: 'd-flex',
            });
            btnContainer.append($('<button>', {
                text: 'Jump to start',
                class: 'btn btn-sm btn-secondary',
                css: {
                    'margin-right': '10px',
                },
                click: () => {
                    elem.setViewToSource(renderer);
                },
            }));
            btnContainer.append($('<button>', {
                text: 'Jump to end',
                class: 'btn btn-sm btn-secondary',
                click: () => {
                    elem.setViewToDestination(renderer);
                },
            }));
            contents.append(btnContainer);
            contents.append($('<br>'));
        }

        for (const attr of Object.entries(elem.attributes() ?? {})) {
            if (attr[0].startsWith('_meta_'))
                continue;

            switch (attr[0]) {
                case 'layout':
                case 'sdfg':
                case '_arrays':
                case 'orig_sdfg':
                case 'transformation_hist':
                case 'position':
                    continue;
                default:
                    contents.append($('<b>', {
                        html: attr[0] + ':&nbsp;&nbsp;',
                    }));
                    contents.append($('<span>', {
                        html: sdfg_property_to_string(
                            attr[1], renderer.view_settings()
                        ),
                    }));
                    contents.append($('<br>'));
                    break;
            }
        }

        // If access node, add array information too
        if (elem instanceof AccessNode) {
            const sdfg_array = elem.sdfg.attributes._arrays[
                elem.attributes().data
            ];
            contents.append($('<br>'));
            contents.append($('<h4>', {
                text: sdfg_array.type + ' properties:',
            }));
            for (const attr of Object.entries(sdfg_array.attributes)) {
                if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                    attr[0].startsWith('_meta_'))
                    continue;
                contents.append($('<b>', {
                    html: attr[0] + ':&nbsp;&nbsp;',
                }));
                contents.append($('<span>', {
                    html: sdfg_property_to_string(
                        attr[1], renderer.view_settings()
                    ),
                }));
                contents.append($('<br>'));
            }
        }

        // If nested SDFG, add SDFG information too
        if (elem instanceof NestedSDFG && elem.attributes().sdfg) {
            const sdfg_sdfg = elem.attributes().sdfg;
            contents.append($('<br>'));
            contents.append($('<h4>', {
                text: 'SDFG properties:',
            }));
            for (const attr of Object.entries(sdfg_sdfg.attributes)) {
                if (attr[0].startsWith('_meta_'))
                    continue;

                switch (attr[0]) {
                    case 'layout':
                    case 'sdfg':
                    case '_arrays':
                    case 'orig_sdfg':
                    case 'transformation_hist':
                    case 'position':
                        continue;
                    default:
                        contents.append($('<b>', {
                            html: attr[0] + ':&nbsp;&nbsp;',
                        }));
                        contents.append($('<span>', {
                            html: sdfg_property_to_string(
                                attr[1], renderer.view_settings()
                            ),
                        }));
                        contents.append($('<br>'));
                        break;
                }
            }
        }

        // For SDFGs and nested SDFGs, add information about the SDFG's data
        // descriptors.
        let descriptors = undefined;
        if (elem instanceof SDFG)
            descriptors = elem.attributes()._arrays;
        else if (elem instanceof NestedSDFG)
            descriptors = elem.attributes().sdfg.attributes._arrays;

        if (descriptors) {
            contents.append($('<hr>'));
            contents.append($('<b>', {
                html: 'Data containers:&nbsp;&nbsp;',
            }));
            contents.append($('<hr>'));
            for (const desc in descriptors) {
                contents.append($('<b>', {
                    html: desc + ':&nbsp;&nbsp;',
                }));
                contents.append($('<span>', {
                    html: sdfg_property_to_string(
                        descriptors[desc], renderer.view_settings()
                    ),
                }));
                contents.append($('<br>'));
            }
            contents.append($('<hr>'));
        }
    }

}
