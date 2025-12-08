// Copyright 2019-2025 ETH Zurich and the DaCe authors. All rights reserved.

import type { SDFGElement } from './renderer/sdfg/sdfg_elements';
import type { DagreGraph, SDFGRenderer } from './renderer/sdfg/sdfg_renderer';


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
