import { ContextMenu } from '../../utils/context_menu';
import { htmlSanitize } from '../../utils/sanitization';
import { PixiRenderer } from './pixi_renderer';

const vscode = (globalThis as any).vscode as undefined | Record<any, any>;

export function createToolbar(renderer: PixiRenderer): HTMLElement {
    // Create toolbar element
    const toolbar = document.createElement('div');
    toolbar.style.position = 'absolute';
    toolbar.style.top = toolbar.style.left = '10px';

    // Menu
    let menu: ContextMenu | null = null;
    let overlaysMenu: ContextMenu | null = null;
    toolbar.appendChild(createButton({
        title: 'Menu',
        materialIcon: 'menu',
        onClick: (button) => {
            if (menu?.visible()) {
                menu.destroy();
                return;
            }

            menu = new ContextMenu();
            const rect = button.getBoundingClientRect();
            menu.addOption('Save all as PNG', () => renderer.saveAsPNG());
            menu.addOption('Save view as PDF', () => renderer.saveAsPDF());
            menu.addOption('Save all as PDF', () => renderer.saveAsPDF(true));
            menu.addCheckableOption('Inclusive ranges', renderer.getSettings().inclusiveRanges, (_, checked) => { renderer.updateSettings({ inclusiveRanges: checked }); });
            if (!vscode)
                menu.addOption(
                    'Overlays',
                    () => {
                        if (overlaysMenu && overlaysMenu.visible()) {
                            overlaysMenu.destroy();
                            return;
                        }
                        const rect = menu?._cmenu_elem?.getBoundingClientRect();
                        overlaysMenu = new ContextMenu();
                        overlaysMenu.addCheckableOption(
                            'Memory volume analysis',
                            renderer.getSettings().memoryVolumeOverlay,
                            (_, checked) => {
                                renderer.updateSettings({ memoryVolumeOverlay: checked });
                                if (vscode)
                                    (globalThis as any).refresh_analysis_pane();
                            }
                        );
                        overlaysMenu.show(rect?.left ?? 10, rect?.top ?? 10);
                    }
                );
            menu.addCheckableOption('Hide Access Nodes', renderer.getSettings().omitAccessNodes, (_, checked) => { renderer.updateSettings({ omitAccessNodes: checked }); });
            menu.show(rect.left, rect.bottom);
        },
    }));

    // Zoom to fit
    toolbar.appendChild(createButton({
        title: 'Zoom to fit SDFG',
        materialIcon: 'filter_center_focus',
        onClick: () => renderer.zoomToView(),
    }));

    // Collapse all
    toolbar.appendChild(createButton({
        title: 'Collapse all elements',
        materialIcon: 'unfold_less',
        onClick: () => renderer.collapseAll(),
    }));

    // Expand all
    toolbar.appendChild(createButton({
        title: 'Expand all elements',
        materialIcon: 'unfold_more',
        onClick: () => renderer.expandAll(),
    }));

    // Object moving mode
    const movingMode = createToggleButton({
        states: {
            true: {
                title: 'Exit object moving mode',
                materialIcon: 'done',
                onClick: () => renderer.updateSettings({ moveMode: 'pan' }),
            },
            false: {
                title: 'Enter object moving mode',
                materialIcon: 'open_with',
                onClick: () => renderer.updateSettings({ moveMode: 'move' }),
            }
        },
        getState: () => `${renderer.getSettings().moveMode === 'move'}`,
    });
    toolbar.appendChild(movingMode.button);
    renderer.onSettingsChange(() => movingMode.updateState());

    // Box selection mode
    const boxSelection = createToggleButton({
        states: {
            true: {
                title: 'Exit box select mode',
                materialIcon: 'done',
                onClick: () => renderer.updateSettings({ moveMode: 'pan' }),
            },
            false: {
                title: 'Enter box select mode',
                materialIcon: 'border_style',
                onClick: () => renderer.updateSettings({ moveMode: 'select' }),
            }
        },
        getState: () => `${renderer.getSettings().moveMode === 'select'}`,
    });
    toolbar.appendChild(boxSelection.button);
    renderer.onSettingsChange(() => boxSelection.updateState());

    /*
    // Exit previewing mode
    if (vscode) {
        const exit_preview_btn = document.createElement('button');
        exit_preview_btn.id = 'exit-preview-button';
        exit_preview_btn.className = 'button hidden';
        exit_preview_btn.innerHTML = '<i class="material-icons">close</i>';
        exit_preview_btn.style = 'padding-bottom: 0px; user-select: none';
        exit_preview_btn.onclick = () => {
            exit_preview_btn.className = 'button hidden';
            window.viewing_history_state = false;
            if (vscode) {
                vscode.postMessage({
                    type: 'sdfv.get_current_sdfg',
                    prevent_refreshes: true,
                });
                vscode.postMessage({
                    type: 'transformation_history.refresh',
                    reset_active: true,
                });
            }
        };
        exit_preview_btn.title = 'Exit preview';
        this.toolbar.appendChild(exit_preview_btn);
    }*/

    return toolbar;

}

/**
 * Creates a button with multiple states. When the state changes, call the `updateState` method. `updateState` is called
 * automatically after a button click.
 */
function createToggleButton<S extends string | number | symbol>(details: {
    states: Record<S, {
        title: string,
        materialIcon: string,
        onClick: (button: HTMLElement) => void,
    }>,
    getState: () => S,
}): { button: HTMLElement, updateState: () => void } {
    const button = document.createElement('button');
    button.className = 'button';
    button.style.paddingBottom = '0px';
    button.style.userSelect = 'none';
    let onClickFunc = () => undefined as void;
    button.onclick = () => onClickFunc();
    const updateState = () => {
        const state = details.getState();
        const stateObj = details.states[state];
        if (!stateObj) {
            throw new Error(`Unknown state: ${state}`);
        }
        button.title = details.states[state].title;
        button.innerHTML = htmlSanitize`<i class="material-icons">${details.states[state].materialIcon}</i>`;
        onClickFunc = () => {
            details.states[state].onClick(button);
            updateState();
        };
    };
    updateState();
    return {
        button,
        updateState,
    };
}

function createButton(details: {
    title: string,
    materialIcon: string,
    onClick: (button: HTMLElement) => void,
}): HTMLElement {
    const button = document.createElement('button');
    button.className = 'button';
    button.innerHTML = htmlSanitize`<i class="material-icons">${details.materialIcon}</i>`;
    button.style.paddingBottom = '0px';
    button.style.userSelect = 'none';
    button.onclick = () => details.onClick(button);
    button.title = details.title;
    return button;
}
