// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import $ from 'jquery';

import { editor } from 'monaco-editor';
import { SDFV } from './sdfv';
import type { JsonSDFG, ModeButtons } from './types';
import { SDFVSettings } from './utils/sdfv_settings';
import { SDFGDiffViewer, type DiffMap } from './sdfg_diff_viewer';
import {
    checkCompatLoad,
    checkCompatSave,
    parseSDFG,
    stringifySDFG,
} from './utils/sdfg/json_serializer';
import {
    findInGraph,
    findInGraphPredicate,
    traverseSDFGScopes,
} from './utils/sdfg/traversal';
import { htmlSanitize } from './utils/sanitization';
import { SDFGRenderer, DagreGraph } from './renderer/sdfg/sdfg_renderer';
import {
    SDFG,
    SDFGElement,
    State,
    Edge,
    Memlet,
    AccessNode,
    NestedSDFG,
} from './renderer/sdfg/sdfg_elements';
import { OverlayManager } from './overlay_manager';
import { GenericSdfgOverlay } from './overlays/common/generic_sdfg_overlay';
import { showErrorModal } from './utils/utils';
import type { ISDFVUserInterface } from './sdfv_ui';
import { sdfgPropertyToString } from './utils/sdfg/display';
import { Modal } from 'bootstrap';
import { DiffOverlay } from './overlays/diff_overlay';


declare const vscode: any;


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

export class WebSDFGDiffViewer extends SDFGDiffViewer {

    private readonly UI: SDFVWebUI = SDFVWebUI.getInstance();

    public get linkedUI(): SDFVWebUI {
        return this.UI;
    }

    private initUI(): void {
        $('#sdfg-file-input').prop('disabled', true);
        $('#reload').prop('disabled', true);
        $('#load-instrumentation-report-btn').prop('disabled', true);
        $('#load-memory-footprint-file-btn').prop('disabled', true);
        $('#diff-view-btn-container').hide();

        $('#exit-diff-view-btn-container').show();
    }

    private deconstructUI(): void {
        $('#sdfg-file-input').prop('disabled', false);
        $('#reload').prop('disabled', false);
        $('#load-instrumentation-report-btn').prop('disabled', false);
        $('#load-memory-footprint-file-btn').prop('disabled', false);
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
        $(document).on(
            'click.sdfv-diff', '#search-btn', (e) => {
                e.preventDefault();
                this.runSearch(false);
                return false;
            }
        );
        $(document).on(
            'click.sdfv-diff', '#advsearch-btn', (e) => {
                e.preventDefault();
                this.runSearch(true);
                return false;
            }
        );
        $(document).on(
            'keydown.sdfv-diff', '#search', (e) => {
                if (e.key === 'Enter' || e.which === 13) {
                    this.runSearch(false);
                    e.preventDefault();
                }
            }
        );
    }

    private deregisterEventListeners(): void {
        $(document).off('.sdfv-diff');
    }

    public exitDiff(): void {
        $('#diff-container').hide();

        this.destroy();

        this.deregisterEventListeners();
        this.deconstructUI();

        // Re-instantiate the regular SDFG viewer (SDFV).
        $('#contents').show();
        WebSDFV.getInstance().registerEventListeners();
        void WebSDFV.getInstance().setSDFG(
            this.rightRenderer?.sdfg,
            this.rightRenderer?.canvasManager.getUserTransform()
        );
    }

    public static init(
        graphA: JsonSDFG, graphB: JsonSDFG, precomputedDiff?: DiffMap
    ): WebSDFGDiffViewer {
        const leftContainer = document.getElementById('diff-contents-A');
        const rightContainer = document.getElementById('diff-contents-B');
        if (!leftContainer || !rightContainer)
            throw Error('Failed to find diff renderer containers');

        const viewer = new WebSDFGDiffViewer();
        const leftRenderer = new SDFGRenderer(
            leftContainer, viewer, null, null, false, null,
            undefined, {
                settings: true,
                zoomToFit: true,
                zoomToFitWidth: true,
                collapse: true,
                expand: true,
            }
        );
        const rightRenderer = new SDFGRenderer(
            rightContainer, viewer, null, null, false, null,
            undefined, {
                zoomToFit: true,
                zoomToFitWidth: true,
                collapse: true,
                expand: true,
            }
        );
        viewer.leftRenderer = leftRenderer;
        viewer.rightRenderer = rightRenderer;

        void leftRenderer.setSDFG(graphA);
        void rightRenderer.setSDFG(graphB);

        viewer.registerEventListeners();
        viewer.initUI();

        const rendererSelectionChange = (renderer: SDFGRenderer) => {
            const selectedElements = renderer.selectedRenderables;
            let element;
            if (selectedElements.size === 0 && renderer.sdfg) {
                element = new SDFG(
                    renderer, renderer.ctx, renderer.minimapCtx, renderer.sdfg
                );
            } else if (selectedElements.size === 1) {
                element = Array.from(selectedElements)[0];
            } else {
                element = null;
            }

            if (element !== null) {
                viewer.UI.showElementInfo(element, renderer);
            } else {
                SDFVWebUI.getInstance().infoClear();
                SDFVWebUI.getInstance().infoSetTitle(
                    'Multiple elements selected'
                );
            }
            SDFVWebUI.getInstance().infoShow();
        };
        leftRenderer.on('selection_changed', () => {
            rightRenderer.deselect();
            rendererSelectionChange(leftRenderer);
        });
        rightRenderer.on('selection_changed', () => {
            leftRenderer.deselect();
            rendererSelectionChange(rightRenderer);
        });

        // Warn if one or both of the SDFGs are probably not diff-ready yet.
        if (!graphA.dace_version || graphA.dace_version < '0.16.2' ||
            !graphB.dace_version || graphB.dace_version < '0.16.2') {
            const warnModalHtml = `
<div class="modal-dialog">
    <div class="modal-content">
        <div class="modal-header">
            <h5 class="modal-title">Incompatibility Warning</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close">
                <span aria-hidden="true">&times;</span>
            </button>
        </div>
        <div class="modal-body">
            <p>
                One or both of the SDFGs you are trying to compare have been
                generated with a version of DaCe that does not yet officially
                support SDFG diffs. SDFG diffs are supported for SDFGs created
                from DaCe version 0.16.2 or newer. The resulting diff may be
                incorrect.
            </p>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
        </div>
    </div>
</div>
            `;
            const warnModal = $('<div>', {
                class: 'modal',
                tabindex: '-1',
                html: warnModalHtml,
            });

            $('body.sdfv').append(warnModal);
            const modalObj = new Modal(warnModal[0]);
            modalObj.show();
            warnModal[0].addEventListener('hidden.bs.modal', () => {
                warnModal.remove();
            });
        }

        const lSDFG = new SDFG(
            leftRenderer, leftRenderer.ctx, leftRenderer.minimapCtx, graphA
        );
        lSDFG.sdfgDagreGraph = leftRenderer.graph ?? undefined;
        const rSDFG = new SDFG(
            rightRenderer, rightRenderer.ctx, rightRenderer.minimapCtx, graphB
        );
        rSDFG.sdfgDagreGraph = rightRenderer.graph ?? undefined;

        const onDiffCreated = (diff: DiffMap) => {
            viewer.diffMap = diff;
            const leftOverlay = new DiffOverlay(leftRenderer, diff);
            const rightOverlay = new DiffOverlay(rightRenderer, diff);
            leftRenderer.overlayManager.registerOverlayInstance(
                leftOverlay
            );
            rightRenderer.overlayManager.registerOverlayInstance(
                rightOverlay
            );
        };

        if (precomputedDiff) {
            onDiffCreated(precomputedDiff);
        } else {
            const diff = SDFGDiffViewer.diff(lSDFG, rSDFG);
            onDiffCreated(diff);
        }

        return viewer;
    }

    public runSearch(advanced: boolean = false): void {
        // Make sure the UI is not blocked during search.
        setTimeout(() => {
            const query = advanced ? $('#advsearch').val() : $('#search').val();
            if (query) {
                if (advanced) {
                    const predicate = eval(query.toString()) as (
                        g: DagreGraph, elem: SDFGElement
                    ) => boolean;
                    this.findInDiffGraphPredicate(predicate);
                } else {
                    const caseSensitive = $('#search-case').is(':checked');
                    const queryString = caseSensitive ?
                        query.toString() : query.toString().toLowerCase();
                    this.findInDiffGraphPredicate(
                        (g: DagreGraph, elem: SDFGElement) => {
                            const text = caseSensitive ? elem.textForFind() :
                                elem.textForFind().toLowerCase();
                            return text.includes(queryString);
                        }
                    );
                }
            }
        }, 1);
    }

}

export class WebSDFV extends SDFV {

    private static readonly INSTANCE: WebSDFV = new WebSDFV();
    private _initialized: boolean = false;

    private constructor() {
        super();
    }

    public static getInstance(): WebSDFV {
        return this.INSTANCE;
    }

    public get linkedUI(): SDFVWebUI {
        return SDFVWebUI.getInstance();
    }

    private currentSDFGFile?: File;
    private modeButtons?: ModeButtons;

    public get initialized(): boolean {
        return this._initialized;
    }

    public init(): void {
        if (this._initialized)
            return;

        // This is called here to initialize the monaco editor web workers for
        // tokenization. There is no way to await this creation, which leads to
        // code not being correctly highlighted in tasklets for the first time
        // an SDFG is loaded. Initializing this here ensures that by the time
        // the user loads an SDFG, the web workers are already created and
        // highlighting works.
        const _tokens = editor.tokenize('a = 0', 'python')[0];
        // Read something from tokens to ensure the call is not optimized away.
        if (_tokens.length < 2)
            console.log('Initializing Monaco');
        else
            console.log('Monaco already initialized');

        // Try to load any previous settings state from localStorage.
        SDFVSettings.getInstance().tryInitializeFromLocalStorage();

        this.registerEventListeners();
        this.linkedUI.init();

        this._initialized = true;

        this.emit('initialized');
    }

    public setModeButtons(modeButtons: ModeButtons): void {
        this.modeButtons = modeButtons;
    }

    private loadSDFG(change: JQuery.TriggeredEvent): void {
        const target = change.target as { files?: File[] } | undefined;
        console.log(target);
        if ((target?.files?.length ?? 0) < 1)
            return;
        this.currentSDFGFile = target!.files![0];
        console.log(this.currentSDFGFile);
        this.readSDFGFile();
    }

    private readSDFGFile(): void {
        if (!this.currentSDFGFile)
            return;

        const fileReader = new FileReader();
        fileReader.onload = async (e) => {
            const resultString = e.target?.result;

            if (resultString) {
                const parsedSDFG = await this.linkedUI.showActivityIndicatorFor(
                    'Parsing SDFG',
                    () => {
                        return checkCompatLoad(parseSDFG(resultString));
                    }
                );
                console.log(parsedSDFG);
                this.setSDFG(parsedSDFG).catch(console.error);
            }
        };
        fileReader.readAsArrayBuffer(this.currentSDFGFile);
    }

    public enterDiffView(
        sdfgA: JsonSDFG, sdfgB: JsonSDFG, precomputedDiff?: DiffMap
    ): void {
        $('#contents').hide();

        this.renderer?.destroy();

        this.linkedUI.infoClear();
        this.deregisterEventListeners();

        WebSDFGDiffViewer.init(sdfgA, sdfgB, precomputedDiff);

        $('#diff-container').show();
    }

    private loadDiffSDFG(e: JQuery.TriggeredEvent): void {
        const target = e.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1 || !target!.files![0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e) => {
            const sdfgB = this.renderer?.sdfg;
            if (e.target?.result && sdfgB) {
                const sdfgA = checkCompatLoad(parseSDFG(e.target.result));
                this.enterDiffView(sdfgA, sdfgB);
            }
        };
        fileReader.readAsArrayBuffer(target!.files![0]);
        // Reset the input to nothing so we are able to observe a change event
        // again if the user wants to re-diff with the same file again.
        (e.target as HTMLInputElement).value = '';
    }

    private loadRuntimeReportFile(e: JQuery.TriggeredEvent): void {
        const target = e.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1 || !target!.files![0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e: ProgressEvent<FileReader>) => {
            let resultString = '';
            const res = e.target?.result;
            if (res) {
                if (res instanceof ArrayBuffer) {
                    const decoder = new TextDecoder('utf-8');
                    resultString = decoder.decode(new Uint8Array(res));
                } else {
                    resultString = res;
                }
            }
            this.onLoadedRuntimeReport(
                JSON.parse(resultString) as { traceEvents?: any[] }
            );
        };
        fileReader.readAsText(target!.files![0]);
    }

    private loadMemoryFootprintFile(e: JQuery.TriggeredEvent): void {
        const target = e.target as { files?: File[] } | undefined;
        if ((target?.files?.length ?? 0) < 1 || !target!.files![0])
            return;

        const fileReader = new FileReader();
        fileReader.onload = (e: ProgressEvent<FileReader>) => {
            let resultString = '';
            const res = e.target?.result;
            if (res) {
                if (res instanceof ArrayBuffer) {
                    const decoder = new TextDecoder('utf-8');
                    resultString = decoder.decode(new Uint8Array(res));
                } else {
                    resultString = res;
                }
            }
            this.onLoadedMemoryFootprintFile(
                JSON.parse(resultString) as Record<string, number>
            );
        };
        fileReader.readAsText(target!.files![0]);
    }

    public registerEventListeners(): void {
        $(document).on(
            'change.sdfv', '#sdfg-file-input', this.loadSDFG.bind(this)
        );
        $(document).on(
            'change.sdfv', '#instrumentation-report-file-input',
            this.loadRuntimeReportFile.bind(this)
        );
        $(document).on(
            'change.sdfv', '#memory-footprint-file-input',
            this.loadMemoryFootprintFile.bind(this)
        );
        $(document).on(
            'change.sdfv', '#second-sdfg-file-input',
            this.loadDiffSDFG.bind(this)
        );

        $(document).on(
            'click.sdfv', '#reload', this.readSDFGFile.bind(this)
        );
        $(document).on(
            'click.sdfv', '#outline', () => {
                // Make sure the UI is not blocked in the meantime.
                setTimeout(() => {
                    this.outline();
                }, 1);
            }
        );
        $(document).on(
            'click.sdfv', '#search-btn', (e) => {
                e.preventDefault();
                this.runSearch(false);
                return false;
            }
        );
        $(document).on(
            'click.sdfv', '#advsearch-btn', (e) => {
                e.preventDefault();
                this.runSearch(true);
                return false;
            }
        );

        $(document).on(
            'keydown.sdfv', '#search', (e) => {
                if (e.key === 'Enter' || e.which === 13) {
                    this.runSearch();
                    e.preventDefault();
                }
            }
        );
    }

    public deregisterEventListeners(): void {
        $(document).off('.sdfv');
    }

    public outline(): void {
        if (!this.renderer?.graph)
            return;

        this.linkedUI.infoSetTitle('SDFG Outline');

        const sidebar = this.linkedUI.infoContentContainer;
        if (!sidebar)
            return;
        sidebar.html('');

        // Entire SDFG
        $('<div>', {
            class: 'context_menu_option',
            html: htmlSanitize`
                <span class="material-symbols-outlined"
                      style="font-size: inherit">
                    filter_center_focus
                </span> SDFG ${this.renderer.sdfg?.attributes?.name}
            `,
            click: () => {
                this.renderer?.zoomToFitContents();
            },
        }).appendTo(sidebar);

        const stack: (JQuery | null)[] = [sidebar];

        // Add elements to tree view in sidebar
        traverseSDFGScopes(this.renderer.graph, (node, parent) => {
            // Skip exit nodes when scopes are known
            if (node.type.endsWith('Exit') && node.jsonData?.scope_entry &&
                node.jsonData.scope_entry as number >= 0) {
                stack.push(null);
                return true;
            }

            let isCollapsed = node.attributes()?.is_collapsed;
            isCollapsed = (isCollapsed === undefined) ? false : isCollapsed;
            let nodeType = node.type;

            // If a scope has children, remove the name "Entry" from the type
            if (node.type.endsWith('Entry') && node.parentStateId && node.id) {
                const state = (node.parentElem as State | undefined)?.jsonData;
                if (state?.scope_dict?.[node.id])
                    nodeType = nodeType.slice(0, -5);
            }

            // Create element
            const entry = $('<div>', {
                class: 'context_menu_option',
                html: htmlSanitize`
                    ${nodeType} ${node.label}${isCollapsed ? ' (collapsed)' : ''}
                `,
                click: (e: JQuery.Event) => {
                    // Show node or entire scope
                    const nodesToDisplay = [node];
                    if (node.type.endsWith('Entry') && node.parentElem &&
                        node.id) {
                        const state = (
                            node.parentElem as State | undefined
                        )?.jsonData;
                        if (state?.scope_dict?.[node.id]) {
                            const scNodes = state.scope_dict[node.id];
                            for (const subnodeId of scNodes ?? []) {
                                const subnd = parent.node(subnodeId.toString());
                                if (subnd)
                                    nodesToDisplay.push(subnd);
                            }
                        }
                    }

                    this.renderer?.zoomToFit(nodesToDisplay);

                    // Ensure that the innermost div handles the event.
                    /* eslint-disable
                       @typescript-eslint/no-unnecessary-condition,
                       @typescript-eslint/no-deprecated */
                    if (!e) {
                        if (window.event) {
                            window.event.cancelBubble = true;
                            window.event.stopPropagation();
                        }
                    } else {
                        if (e.stopPropagation)
                            e.stopPropagation();
                    }
                    /* eslint-enable
                       @typescript-eslint/no-unnecessary-condition,
                       @typescript-eslint/no-deprecated */
                },
            });
            stack.push(entry);

            // If is collapsed, don't traverse further
            if (isCollapsed)
                return false;

            return true;
        }, (_node, _parent) => {
            // After scope ends, pop ourselves as the current element
            // and add to parent
            const elem = stack.pop();
            if (elem)
                stack[stack.length - 1]?.append(elem);
        });

        this.linkedUI.infoShow();
    }

    public runSearch(advanced: boolean = false): void {
        // Make sure the UI is not blocked during search.
        setTimeout(() => {
            const query = advanced ? $('#advsearch').val() : $('#search').val();
            if (query && this.renderer) {
                if (advanced) {
                    const predicate = eval(query.toString()) as (
                        graph: DagreGraph, element: SDFGElement
                    ) => boolean;
                    findInGraphPredicate(
                        this.linkedUI, this.renderer, predicate
                    );
                } else {
                    findInGraph(
                        this.linkedUI, this.renderer, query.toString(),
                        $('#search-case').is(':checked')
                    );
                }
            }
        }, 1);
    }

    public async setSDFG(
        sdfg: JsonSDFG | null = null,
        userTransform: DOMMatrix | null = null,
        debugDraw: boolean = false,
        contentsContainerId: string = 'contents',
        zoomToFit: boolean = true
    ): Promise<void> {
        this.renderer?.destroy();
        const container = document.getElementById(contentsContainerId);
        this.linkedUI.infoClear();
        if (container && sdfg) {
            const renderer = new SDFGRenderer(
                container, this, null, userTransform, debugDraw, null,
                this.modeButtons
            );
            this.setRenderer(renderer);
            renderer.on('selection_changed', () => {
                const selectedElements = renderer.selectedRenderables;
                let element;
                if (selectedElements.size === 0 && renderer.sdfg) {
                    element = new SDFG(
                        renderer, renderer.ctx, renderer.minimapCtx,
                        renderer.sdfg
                    );
                } else if (selectedElements.size === 1) {
                    element = Array.from(selectedElements)[0];
                } else {
                    element = null;
                }

                if (element !== null) {
                    SDFVWebUI.getInstance().showElementInfo(element, renderer);
                } else {
                    SDFVWebUI.getInstance().infoClear();
                    SDFVWebUI.getInstance().infoSetTitle(
                        'Multiple elements selected'
                    );
                }
                SDFVWebUI.getInstance().infoShow();
            });

            await renderer.setSDFG(sdfg, true, zoomToFit);
            $('#load-instrumentation-report-btn').prop('disabled', false);
            $('#load-memory-footprint-file-btn').prop('disabled', false);
            $('#diff-view-btn').prop('disabled', false);
        }
    }

}

// https://stackoverflow.com/a/901144/6489142
function getParameterByName(name: string): string | null {
    const url = window.location.href;
    name = name.replace(/[\[\]]/g, '\\$&');
    const regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results)
        return null;
    if (!results[2])
        return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function loadSDFGFromURL(url: string): void {
    const request = new XMLHttpRequest();
    request.responseType = 'text'; // Will be parsed as JSON by parse_sdfg
    request.onload = () => {
        if (request.status === 200) {
            const sdfg = checkCompatLoad(parseSDFG(request.response as string));
            void WebSDFV.getInstance().setSDFG(sdfg, null);
        } else {
            showErrorModal('Failed to load SDFG from URL');
            void WebSDFV.getInstance().setSDFG(null);
        }
    };
    request.onerror = () => {
        showErrorModal(
            'Failed to load SDFG from URL. Error code: ' +
            request.status.toString()
        );
        void WebSDFV.getInstance().setSDFG(null);
    };
    request.open(
        'GET', url + (url.includes('?') ? '&' : '?') +
        (new Date()).getTime().toString(),
        true
    );
    request.send();
}

function parseScriptParamValue(
    val: string
): boolean | string | number | null | undefined {
    if (val === 'true')
        return true;
    if (val === 'false')
        return false;
    if (val === 'null')
        return null;
    if (val === 'undefined')
        return undefined;
    if (!isNaN(+val))
        return +val;
    return val;
}

function settingReadDefault(
    name: string, def: boolean | string | number | null | undefined
): boolean | string | number | null | undefined {
    if (document.currentScript?.hasAttribute(name)) {
        const attr = document.currentScript.getAttribute(name);
        if (attr)
            return parseScriptParamValue(attr);
    }

    const param = getParameterByName(name);
    if (param)
        return parseScriptParamValue(param);

    return def;
}

$(() => {
    // Do not run initiailization code if inside of VSCode.
    try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        vscode;
        if (vscode)
            return;
    } catch (_) { }

    // Set the default settings based on the current script's attributes
    // or URL parameters.
    const isEmbedded = document.getElementById('embedded') !== null;
    if (isEmbedded) {
        SDFVSettings.set<boolean>('toolbar', false);
        SDFVSettings.set<boolean>('minimap', false);
    }

    // Check if any of the remaining settings are provided via the URL.
    for (const key of SDFVSettings.settingsKeys) {
        const overrideVal = settingReadDefault(key, undefined);
        if (overrideVal !== undefined)
            SDFVSettings.set(key, overrideVal);
    }

    WebSDFV.getInstance().init();

    // If the renderer is not null, an SDFG has already been set from somewhere
    // else.
    if (WebSDFV.getInstance().renderer === undefined) {
        if (document.currentScript?.hasAttribute('data-sdfg-json')) {
            const sdfgString =
                document.currentScript.getAttribute('data-sdfg-json');
            if (sdfgString) {
                void WebSDFV.getInstance().setSDFG(
                    checkCompatLoad(parseSDFG(sdfgString)), null
                );
            }
        } else if (document.currentScript?.hasAttribute('data-url')) {
            const url =
                document.currentScript.getAttribute('data-url');
            if (url)
                loadSDFGFromURL(url);
        } else {
            const url = getParameterByName('url');
            if (url)
                loadSDFGFromURL(url);
            else
                void WebSDFV.getInstance().setSDFG(null);
        }
    }
});

// Define global exports outside of webpack
declare global {
    interface Window {
        // Extensible classes for rendering and overlays
        OverlayManager: typeof OverlayManager;
        GenericSdfgOverlay: typeof GenericSdfgOverlay;
        SDFGElement: typeof SDFGElement;

        // API classes
        SDFV: typeof SDFV;
        WebSDFV: typeof WebSDFV;
        SDFGRenderer: typeof SDFGRenderer;

        // Exported functions
        parseSDFG: (sdfgJson: string) => JsonSDFG;
        stringifySDFG: (sdfg: JsonSDFG) => string;
        checkCompatLoad: (sdfg: JsonSDFG) => JsonSDFG;
        checkCompatSave: (sdfg: JsonSDFG) => JsonSDFG;
    }
}

window.OverlayManager = OverlayManager;
window.GenericSdfgOverlay = GenericSdfgOverlay;
window.SDFGElement = SDFGElement;
window.SDFV = SDFV;
window.WebSDFV = WebSDFV;
window.SDFGRenderer = SDFGRenderer;
window.parseSDFG = parseSDFG;
window.stringifySDFG = stringifySDFG;
window.checkCompatLoad = checkCompatLoad;
window.checkCompatSave = checkCompatSave;

