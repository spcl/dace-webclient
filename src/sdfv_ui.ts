// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';
import {
    AccessNode,
    Edge,
    Memlet,
    NestedSDFG,
    SDFG,
    SDFGElement,
} from './renderer/sdfg/sdfg_elements';
import type { DagreGraph, SDFGRenderer } from './renderer/sdfg/sdfg_renderer';
import { WebSDFV } from './sdfv';
import { JsonSDFG } from './types';
import { sdfgPropertyToString } from './utils/sdfg/display';


export interface ISDFVUserInterface {
    get infoContentContainer(): JQuery | undefined;
    init(): void;
    infoClear(hide?: boolean): void;
    infoHide(): void;
    infoShow(overrideHidden?: boolean): void;
    infoSetTitle(title: string): void;
    disableInfoClear(): void;
    enableInfoClear(): void;
    showElementInfo(
        elem: SDFGElement | DagreGraph | null | undefined,
        renderer: SDFGRenderer
    ): void;
    showActivityIndicatorFor<T>(
        message: string, fun: (...args: unknown[]) => Promise<T>
    ): Promise<T>;
}

export class SDFVWebUI implements ISDFVUserInterface {

    private static readonly INSTANCE: SDFVWebUI = new SDFVWebUI();

    private activities: [
        string, (...args: unknown[]) => unknown
    ][] = [];
    private activityIndicator?: JQuery;
    private activityInfoField?: JQuery;

    private constructor() {
        return;
    }

    public static getInstance(): SDFVWebUI {
        return this.INSTANCE;
    }

    public get infoContentContainer(): JQuery | undefined {
        return $('#sidebar-contents');
    }

    private initInfo(): void {
        const right = document.getElementById('sidebar');
        const bar = document.getElementById('dragbar');

        const drag = (e: MouseEvent) => {
            window.getSelection()?.removeAllRanges();

            if (right) {
                right.style.width = Math.max(
                    ((e.view ? e.view.innerWidth - e.pageX : 0)), 20
                ).toString() + 'px';
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
        const panBtn = $('#pan-btn');
        const moveBtn = $('#move-btn');
        const selectBtn = $('#select-btn');
        const addBtns: JQuery<HTMLButtonElement>[] = [];
        for (const btnId of [
            'elem_map',
            'elem_consume',
            'elem_tasklet',
            'elem_nested_sdfg',
            'elem_access_node',
            'elem_stream',
            'elem_state',
        ]) {
            const elem = $(`#${btnId}`);
            if (elem.length)
                addBtns.push(elem as JQuery<HTMLButtonElement>);
        }
        if (panBtn.length && moveBtn.length && selectBtn.length) {
            WebSDFV.getInstance().setModeButtons({
                pan: panBtn as JQuery<HTMLButtonElement>,
                move: moveBtn as JQuery<HTMLButtonElement>,
                select: selectBtn as JQuery<HTMLButtonElement>,
                addBtns: addBtns,
            });
        }

        this.activityIndicator = $('#activity-indicator');
        this.activityInfoField = $('#activity-info-field');
    }

    private showActivityIndicator(): void {
        this.hideActivityIndicator();
        this.activityIndicator?.append($('<div>', {
            class: 'loader',
        }));
    }

    private hideActivityIndicator(): void {
        this.activityIndicator?.empty();
    }

    public async showActivityIndicatorFor<T>(
        message: string, fun: (...args: unknown[]) => (Promise<T> | T)
    ): Promise<T> {
        if (this.activities.length === 0)
            this.showActivityIndicator();
        this.activities.push([message, fun]);
        this.activityInfoField?.text(message);

        try {
            const ret = await fun();
            this.activities.pop();
            if (this.activities.length === 0) {
                this.hideActivityIndicator();
                this.activityInfoField?.text('');
            } else {
                this.activityInfoField?.text(
                    this.activities[this.activities.length - 1][0]
                );
            }
            return ret;
        } catch (err) {
            this.activities.pop();
            if (this.activities.length === 0) {
                this.hideActivityIndicator();
                this.activityInfoField?.text('');
            } else {
                this.activityInfoField?.text(
                    this.activities[this.activities.length - 1][0]
                );
            }
            console.error('Error during activity:', err);
            throw err;
        }
    }

    public infoClear(hide: boolean = true): void {
        this.infoContentContainer?.html('');
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
        $('#sidebar-header').text(title);
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
        this.infoSetTitle(elem.type + ' ' + elem.label);

        contents.html('');

        if (elem instanceof Memlet) {
            contents.append($('<p>', {
                html: 'Connectors: ' + (elem.srcConnector ?? 'NULL') +
                    ' &rarr; ' + (elem.dstConnector ?? 'NULL'),
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
                case 'possible_reads':
                case 'possible_writes':
                case 'certain_reads':
                case 'certain_writes':
                case 'debuginfo':
                    continue;
                default:
                    contents.append($('<b>', {
                        html: attr[0] + ':&nbsp;&nbsp;',
                    }));
                    contents.append($('<span>', {
                        html: sdfgPropertyToString(attr[1]),
                    }));
                    contents.append($('<br>'));
                    break;
            }
        }

        // If access node, add array information too
        if (elem instanceof AccessNode) {
            const sdfgArray = elem.getDesc();
            const arrAttrs = sdfgArray?.attributes;
            if (sdfgArray && arrAttrs) {
                contents.append($('<br>'));
                contents.append($('<h4>', {
                    text: (sdfgArray.type ?? '') + ' properties:',
                }));
                for (const attr of Object.entries(arrAttrs)) {
                    if (attr[0] === 'layout' || attr[0] === 'sdfg' ||
                        attr[0].startsWith('_meta_') || attr[0] === 'debuginfo')
                        continue;
                    contents.append($('<b>', {
                        html: attr[0] + ':&nbsp;&nbsp;',
                    }));
                    contents.append($('<span>', {
                        html: sdfgPropertyToString(attr[1]),
                    }));
                    contents.append($('<br>'));
                }
            }
        }

        // If nested SDFG, add SDFG information too
        const attrs = elem.attributes();
        if (elem instanceof NestedSDFG && attrs && 'sdfg' in attrs) {
            const nSDFG = attrs.sdfg as JsonSDFG | undefined;
            const sdfgAttrs = nSDFG?.attributes;
            if (nSDFG && sdfgAttrs) {
                contents.append($('<br>'));
                contents.append($('<h4>', {
                    text: 'SDFG properties:',
                }));
                for (const attr of Object.entries(sdfgAttrs)) {
                    if (attr[0].startsWith('_meta_'))
                        continue;

                    switch (attr[0]) {
                        case 'layout':
                        case 'sdfg':
                        case '_arrays':
                        case 'orig_sdfg':
                        case 'transformation_hist':
                        case 'debuginfo':
                        case 'position':
                            continue;
                        default:
                            contents.append($('<b>', {
                                html: attr[0] + ':&nbsp;&nbsp;',
                            }));
                            contents.append($('<span>', {
                                html: sdfgPropertyToString(attr[1]),
                            }));
                            contents.append($('<br>'));
                            break;
                    }
                }
            }
        }

        // For SDFGs and nested SDFGs, add information about the SDFG's data
        // descriptors.
        let descriptors = undefined;
        if (elem instanceof SDFG) {
            descriptors = elem.attributes()?._arrays;
        } else if (elem instanceof NestedSDFG) {
            const nsdfg = elem.attributes()?.sdfg;
            descriptors = nsdfg?.attributes?._arrays;
        }

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
                    html: sdfgPropertyToString(descriptors[desc]),
                }));
                contents.append($('<br>'));
            }
            contents.append($('<hr>'));
        }
    }

}
